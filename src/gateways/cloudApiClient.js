import { trackError } from '../services/errorTracker.js';

const GRAPH_API_VERSION = 'v23.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 8000;

const WHATSAPP_TEXT_LIMIT = 4096;
const TYPING_INDICATOR_TIMEOUT_MS = 4000;

export function createCloudApiSender({ phoneNumberId, accessToken }) {
  if (!phoneNumberId?.trim()) {
    throw new Error('phoneNumberId is required to send WhatsApp messages.');
  }

  if (!accessToken?.trim()) {
    throw new Error('accessToken is required to send WhatsApp messages.');
  }

  function buildSafeBody(body) {
    if (body.length <= WHATSAPP_TEXT_LIMIT) {
      return body;
    }

    console.error(
      `[cloudApiClient] Message body is ${body.length} chars, over ` +
        `WhatsApp's ${WHATSAPP_TEXT_LIMIT}-char limit. Truncating ` +
        'instead of letting the send fail outright — this should ' +
        'be investigated upstream (see the agent-side reply guard).',
    );
    return `${body.slice(0, WHATSAPP_TEXT_LIMIT - 1)}…`;
  }

  async function rawSend(to, body) {
    if (!to?.trim()) {
      throw new Error('A recipient WhatsApp ID is required.');
    }

    if (!body?.trim()) {
      throw new Error('A non-empty message body is required.');
    }

    const safeBody = buildSafeBody(body);
    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response;

    try {
      response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: safeBody },
        }),
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(
          `Sending WhatsApp message timed out after ${REQUEST_TIMEOUT_MS}ms.`,
          { cause: error }
        );
      }

      throw new Error(
        `Failed to reach the WhatsApp Cloud API: ${
          error instanceof Error ? error.message : 'Unknown network error'
        }`,
        { cause: error }
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const httpError = new Error(
        `WhatsApp Cloud API request failed with status ${response.status}: ${errorBody}`
      );
      httpError.status = response.status;
      throw httpError;
    }

    return response.json();
  }

  async function sendMessage(to, body) {
    try {
      return await rawSend(to, body);
    } catch (error) {
      trackError({
        service: 'whatsapp',
        severity: 'critical',
        error,
        retryCount: 0,
        context: { to },
      });
      throw error;
    }
  }

  async function sendTypingIndicator(messageId) {
    if (!messageId?.trim()) {
      return;
    }

    const url = `${GRAPH_API_BASE}/${phoneNumberId}/messages`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, TYPING_INDICATOR_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          typing_indicator: { type: 'text' },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(
          `[cloudApiClient] Typing indicator request failed with status ${response.status}: ${errorBody}`
        );
      }
    } catch (error) {
      console.error(
        '[cloudApiClient] Failed to send typing indicator:',
        error instanceof Error ? error.message : error
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  sendMessage.sendTypingIndicator = sendTypingIndicator;
  sendMessage.rawSend = rawSend;

  return sendMessage;
}
