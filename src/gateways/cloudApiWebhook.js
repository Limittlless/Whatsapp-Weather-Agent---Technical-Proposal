import { Router } from 'express';
import { runAgent as defaultRunAgent } from '../agent/runAgent.js';
import { claimMessage as defaultClaimMessage } from '../services/processedMessages.js';
import { createMetaSignatureVerifier } from '../middleware/verifyMetaSignature.js';
import { isAdminNumber } from '../services/adminAuth.js';
import { isUserAuthorized as defaultIsUserAuthorized } from '../services/userAuthorization.js';
import {
  isAdminCommandMessage,
  executeAdminCommand as defaultExecuteAdminCommand,
} from '../services/adminCommands.js';

const ACCESS_DENIED_MESSAGE =
  '⛔ هذا الرقم غير مصرح له باستخدام البوت.\n' +
  'This number is not authorized to use the bot.';

const ACCESS_CHECK_FAILED_MESSAGE =
  '⚠️ تعذر التحقق من صلاحية الوصول الآن. حاول مرة أخرى لاحقًا.\n' +
  'Could not verify access right now. Please try again later.';

export function createCloudApiWebhookRouter({
  verifyToken,
  runAgentFn = defaultRunAgent,
  sendMessageFn,
  claimMessageFn = defaultClaimMessage,
  isAuthorizedFn = defaultIsUserAuthorized,
  executeAdminCommandFn = defaultExecuteAdminCommand,
  appSecret,
} = {}) {
  if (!verifyToken?.trim()) {
    throw new Error(
      'verifyToken is required to create the webhook router.'
    );
  }

  if (typeof sendMessageFn !== 'function') {
    throw new Error(
      'sendMessageFn is required to create the webhook router.'
    );
  }

  const router = Router();
  const verifyMetaSignature = createMetaSignatureVerifier(appSecret);

  const activeTasks = new Set();

  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
      res.status(200).send(challenge);
      return;
    }

    res.sendStatus(403);
  });

  router.post('/', verifyMetaSignature, (req, res) => {
    const entries = req.body?.entry ?? [];
    res.sendStatus(200);

    setTimeout(() => {
      const task = processIncomingEntries(entries, {
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
        executeAdminCommandFn,
      }).catch((error) => {
        console.error('[webhook] Failed to process webhook payload:', error);
      });

      activeTasks.add(task);
      task.finally(() => activeTasks.delete(task));
    }, 0);
  });
  router.drain = () => Promise.allSettled(Array.from(activeTasks));

  return router;
}

async function processIncomingEntries(
  entries,
  {
    runAgentFn,
    sendMessageFn,
    claimMessageFn,
    isAuthorizedFn,
    executeAdminCommandFn,
  }
) {
  for (const entry of entries) {
    const changes = entry?.changes ?? [];

    for (const change of changes) {
      const messages = change?.value?.messages ?? [];

      for (const message of messages) {
        await handleIncomingMessage(message, {
          runAgentFn,
          sendMessageFn,
          claimMessageFn,
          isAuthorizedFn,
          executeAdminCommandFn,
        });
      }
    }
  }
}

async function handleIncomingMessage(
  message,
  {
    runAgentFn,
    sendMessageFn,
    claimMessageFn,
    isAuthorizedFn,
    executeAdminCommandFn,
  }
) {
  if (message?.type !== 'text') {
    return;
  }

  const whatsappId = message.from;
  const userMessage = message.text?.body;
  const messageId = message.id;

  if (!whatsappId || !userMessage?.trim()) {
    return;
  }

  try {
    const shouldProcess = await claimMessageFn(messageId, whatsappId);

    if (!shouldProcess) {
      console.log(`[webhook] Skipping already-processed message ${messageId}`);
      return;
    }

    const isAdmin = isAdminNumber(whatsappId);

    if (isAdminCommandMessage(userMessage) && isAdmin) {
      try {
        const reply = await executeAdminCommandFn(userMessage, {
          adminWhatsappId: whatsappId,
        });
        await sendMessageFn(whatsappId, reply);
      } catch (error) {
        console.error('[webhook] Admin command failed:', error);
        await sendMessageFn(
          whatsappId,
          'حدث خطأ أثناء تنفيذ الأمر. حاول مرة أخرى.'
        );
      }
      return;
    }

    if (!isAdmin) {
      let isAuthorized;

      try {
        isAuthorized = await isAuthorizedFn(whatsappId);
      } catch (error) {
        console.error('[webhook] Authorization check failed:', error);
        await sendMessageFn(whatsappId, ACCESS_CHECK_FAILED_MESSAGE);
        return;
      }

      if (!isAuthorized) {
        await sendMessageFn(whatsappId, ACCESS_DENIED_MESSAGE);
        return;
      }
    }

    sendMessageFn.sendTypingIndicator?.(messageId);

    const reply = await runAgentFn({ whatsappId, userMessage });
    await sendMessageFn(whatsappId, reply);
  } catch (error) {
    console.error(
      '[webhook] Failed to process an incoming message:',
      error
    );
  }
}
