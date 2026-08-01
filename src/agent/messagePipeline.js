import { randomUUID } from 'node:crypto';

import { runAgent as defaultRunAgent } from './runAgent.js';
import {
  isAdminCommandMessage,
  executeAdminCommand as defaultExecuteAdminCommand,
} from '../services/adminCommands.js';
import { isAdminNumber as defaultIsAdminNumber } from '../services/adminAuth.js';
import { claimMessage as defaultClaimMessage } from '../services/processedMessages.js';
import { isUserAuthorized as defaultIsUserAuthorized } from '../services/userAuthorization.js';
import {
  finishLatencyTimer,
  measureLatency,
  startLatencyTimer,
} from '../lib/latency.js';

export const ACCESS_DENIED_MESSAGE =
  '⛔ هذا الرقم غير مصرح له باستخدام البوت.\n' +
  'This number is not authorized to use the bot.';

export const ACCESS_CHECK_FAILED_MESSAGE =
  '⚠️ تعذر التحقق من صلاحية الوصول الآن. حاول مرة أخرى لاحقًا.\n' +
  'Could not verify access right now. Please try again later.';

export const PROCESSING_FAILED_MESSAGE =
  'تعذر معالجة رسالتك الآن. حاول مرة أخرى بعد قليل.\n' +
  'Could not process your message right now. Please try again shortly.';

const ADMIN_COMMAND_FAILED_MESSAGE =
  'حدث خطأ أثناء تنفيذ الأمر. حاول مرة أخرى.';

const TYPING_INDICATOR_REFRESH_MS = 20_000;

export async function processIncomingMessage(
  { whatsappId, userMessage, messageId } = {},
  {
    runAgentFn = defaultRunAgent,
    sendMessageFn,
    claimMessageFn = defaultClaimMessage,
    isAuthorizedFn = defaultIsUserAuthorized,
    isAdminNumberFn = defaultIsAdminNumber,
    executeAdminCommandFn = defaultExecuteAdminCommand,
    typingIndicatorRefreshMs = TYPING_INDICATOR_REFRESH_MS,
  } = {},
) {
  if (!whatsappId?.trim() || !userMessage?.trim()) {
    return;
  }

  if (typeof sendMessageFn !== 'function') {
    throw new Error(
      'sendMessageFn is required to process an incoming message.',
    );
  }

  const traceId = randomUUID();
  const pipelineStartedAt = startLatencyTimer();
  let pipelineStatus = 'ok';

  try {
    const shouldProcess = await measureLatency(
      traceId,
      'message.claim',
      () => claimMessageFn(messageId, whatsappId),
    );

    if (!shouldProcess) {
      console.log(
        `[messagePipeline] Skipping already-processed message ${messageId}`,
      );
      return;
    }

    const isAdmin = isAdminNumberFn(whatsappId);

    if (isAdminCommandMessage(userMessage) && isAdmin) {
      try {
        const reply = await executeAdminCommandFn(userMessage, {
          adminWhatsappId: whatsappId,
        });
        await sendMessageFn(whatsappId, reply);
      } catch (error) {
        console.error('[messagePipeline] Admin command failed:', error);
        await sendMessageFn(whatsappId, ADMIN_COMMAND_FAILED_MESSAGE);
      }
      return;
    }

    if (!isAdmin) {
      let isAuthorized;

      try {
        isAuthorized = await measureLatency(
          traceId,
          'authorization.check',
          () => isAuthorizedFn(whatsappId),
        );
      } catch (error) {
        console.error(
          '[messagePipeline] Authorization check failed:',
          error,
        );
        await sendMessageFn(whatsappId, ACCESS_CHECK_FAILED_MESSAGE);
        return;
      }

      if (!isAuthorized) {
        await sendMessageFn(whatsappId, ACCESS_DENIED_MESSAGE);
        return;
      }
    }

    let typingIndicatorEnabled = Boolean(
      sendMessageFn.sendTypingIndicator,
    );
    let typingIndicatorInFlight = false;

    const refreshTypingIndicator = () => {
      if (!typingIndicatorEnabled || typingIndicatorInFlight) {
        return;
      }

      typingIndicatorInFlight = true;
      Promise.resolve(
        sendMessageFn.sendTypingIndicator(messageId, whatsappId),
      )
        .then((sent) => {
          if (sent === false) {
            typingIndicatorEnabled = false;
          }
        })
        .catch((error) => {
          typingIndicatorEnabled = false;
          console.warn(
            '[messagePipeline] Disabling typing indicator after failure:',
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => {
          typingIndicatorInFlight = false;
        });
    };

    refreshTypingIndicator();

    const typingIntervalId = typingIndicatorEnabled
      ? setInterval(refreshTypingIndicator, typingIndicatorRefreshMs)
      : null;

    let reply;

    try {
      reply = await measureLatency(
        traceId,
        'agent.total',
        () => runAgentFn({ whatsappId, userMessage, traceId }),
      );
    } finally {
      if (typingIntervalId) {
        clearInterval(typingIntervalId);
      }
    }

    await measureLatency(
      traceId,
      'whatsapp.send',
      () => sendMessageFn(whatsappId, reply),
    );
  } catch (error) {
    pipelineStatus = 'error';
    console.error(
      '[messagePipeline] Failed to process an incoming message:',
      error,
    );

    try {
      await sendMessageFn(whatsappId, PROCESSING_FAILED_MESSAGE);
    } catch (sendError) {
      console.error(
        '[messagePipeline] Failed to send the processing-error reply:',
        sendError,
      );
    }
  } finally {
    finishLatencyTimer(
      traceId,
      'message.total',
      pipelineStartedAt,
      pipelineStatus,
    );
  }
}
