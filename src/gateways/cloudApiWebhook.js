import { Router } from 'express';
import { runAgent as defaultRunAgent } from '../agent/runAgent.js';

export function createCloudApiWebhookRouter({
  verifyToken,
  runAgentFn = defaultRunAgent,
  sendMessageFn,
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

  router.post('/', async (req, res) => {
    res.sendStatus(200);

    const entries = req.body?.entry ?? [];

    for (const entry of entries) {
      const changes = entry?.changes ?? [];

      for (const change of changes) {
        const messages = change?.value?.messages ?? [];

        for (const message of messages) {
          await handleIncomingMessage(message, { runAgentFn, sendMessageFn });
        }
      }
    }
  });

  return router;
}

async function handleIncomingMessage(message, { runAgentFn, sendMessageFn }) {
  if (message?.type !== 'text') {
    return;
  }

  const whatsappId = message.from;
  const userMessage = message.text?.body;

  if (!whatsappId || !userMessage?.trim()) {
    return;
  }

  try {
    const reply = await runAgentFn({ whatsappId, userMessage });
    await sendMessageFn(whatsappId, reply);
  } catch (error) {
    console.error(
      '[webhook] Failed to process an incoming message:',
      error
    );
  }
}
