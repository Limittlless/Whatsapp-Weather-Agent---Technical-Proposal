import 'dotenv/config';
import express from 'express';

import { createCloudApiWebhookRouter } from './gateways/cloudApiWebhook.js';
import { createCloudApiSender } from './gateways/cloudApiClient.js';

const PORT = process.env.PORT || 3000;

function buildApp() {
  const sendMessage = createCloudApiSender({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_CLOUD_API_TOKEN,
  });

  const webhookRouter = createCloudApiWebhookRouter({
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    sendMessageFn: sendMessage,
  });

  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRouter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();

  app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[server] Webhook URL: http://localhost:${PORT}/webhook`);
  });
}

export { buildApp };
