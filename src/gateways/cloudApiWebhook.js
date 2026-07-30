import { Router } from 'express';
import {
  processIncomingMessage as defaultProcessIncomingMessage,
} from '../agent/messagePipeline.js';
import { createMetaSignatureVerifier } from '../middleware/verifyMetaSignature.js';

export function createCloudApiWebhookRouter({
  verifyToken,
  processIncomingMessageFn = defaultProcessIncomingMessage,
  runAgentFn,
  sendMessageFn,
  claimMessageFn,
  isAuthorizedFn,
  isAdminNumberFn,
  executeAdminCommandFn,
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

    const task = new Promise((resolve) => {
      setTimeout(resolve, 0);
    })
      .then(() =>
        processIncomingEntries(entries, {
          processIncomingMessageFn,
          runAgentFn,
          sendMessageFn,
          claimMessageFn,
          isAuthorizedFn,
          isAdminNumberFn,
          executeAdminCommandFn,
        }),
      )
      .catch((error) => {
        console.error('[webhook] Failed to process webhook payload:', error);
      });

    activeTasks.add(task);
    task.finally(() => activeTasks.delete(task));
  });
  router.drain = () => Promise.allSettled(Array.from(activeTasks));

  return router;
}

async function processIncomingEntries(
  entries,
  {
    processIncomingMessageFn,
    runAgentFn,
    sendMessageFn,
    claimMessageFn,
    isAuthorizedFn,
    isAdminNumberFn,
    executeAdminCommandFn,
  }
) {
  for (const entry of entries) {
    const changes = entry?.changes ?? [];

    for (const change of changes) {
      const messages = change?.value?.messages ?? [];

      for (const message of messages) {
        const internalMessage = toInternalMessage(message);

        if (!internalMessage) {
          continue;
        }

        await processIncomingMessageFn(internalMessage, {
          runAgentFn,
          sendMessageFn,
          claimMessageFn,
          isAuthorizedFn,
          isAdminNumberFn,
          executeAdminCommandFn,
        });
      }
    }
  }
}

export function toInternalMessage(message) {
  if (message?.type !== 'text') {
    return null;
  }

  const whatsappId = message.from;
  const userMessage = message.text?.body;
  const messageId = message.id;

  if (!whatsappId || !userMessage?.trim()) {
    return null;
  }

  return { whatsappId, userMessage, messageId };
}
