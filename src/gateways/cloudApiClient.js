const GRAPH_API_VERSION = 'v20.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const REQUEST_TIMEOUT_MS = 8000;

const TYPING_INDICATOR_TIMEOUT_MS = 4000;

export function createCloudApiSender({ phoneNumberId, accessToken }) {
  if (!phoneNumberId?.trim()) {
    throw new Error('phoneNumberId is required to send WhatsApp messages.');
  }

  if (!accessToken?.trim()) {
    throw new Error('accessToken is required to send WhatsApp messages.');
  }

  async function sendMessage(to, body) {
    if (!to?.trim()) {
      throw new Error('A recipient WhatsApp ID is required.');
    }

    if (!body?.trim()) {
      throw new Error('A non-empty message body is required.');
    }

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
          text: { body },
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
      throw new Error(
        `WhatsApp Cloud API request failed with status ${response.status}: ${errorBody}`
      );
    }

    return response.json();
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

  return sendMessage;
}