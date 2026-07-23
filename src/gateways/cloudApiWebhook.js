import { Router } from 'express';
import { runAgent as defaultRunAgent } from '../agent/runAgent.js';
import { claimMessage as defaultClaimMessage } from '../services/processedMessages.js';
import { createMetaSignatureVerifier } from '../middleware/verifyMetaSignature.js';
import { isAdminNumber } from '../services/adminAuth.js';
import {
  isAdminCommandMessage,
  executeAdminCommand,
} from '../services/adminCommands.js';

export function createCloudApiWebhookRouter({
  verifyToken,
  runAgentFn = defaultRunAgent,
  sendMessageFn,
  claimMessageFn = defaultClaimMessage,
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
      processIncomingEntries(entries, {
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
      }).catch((error) => {
        console.error('[webhook] Failed to process webhook payload:', error);
      });
    }, 0);
  });

  return router;
}

async function processIncomingEntries(
  entries,
  { runAgentFn, sendMessageFn, claimMessageFn }
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
        });
      }
    }
  }
}

async function handleIncomingMessage(
  message,
  { runAgentFn, sendMessageFn, claimMessageFn }
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

    if (isAdminCommandMessage(userMessage) && isAdminNumber(whatsappId)) {
      try {
        const reply = await executeAdminCommand(userMessage);
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
