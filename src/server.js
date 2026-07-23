import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { createCloudApiWebhookRouter } from './gateways/cloudApiWebhook.js';
import { createCloudApiSender } from './gateways/cloudApiClient.js';
import { configureErrorTracker } from './services/errorTracker.js';

const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function buildApp() {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (IS_PRODUCTION && !appSecret?.trim()) {
    throw new Error(
      'WHATSAPP_APP_SECRET is required when NODE_ENV=production. ' +
        'Without it, incoming webhook requests cannot be verified as ' +
        "genuinely coming from Meta. Set it in Railway's Variables tab."
    );
  }

  const sendMessage = createCloudApiSender({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_CLOUD_API_TOKEN,
  });

  configureErrorTracker({
    sendAlertFn: sendMessage.rawSend,
    adminNumber: process.env.ADMIN_ALERT_WHATSAPP_NUMBER,
  });

  const webhookRouter = createCloudApiWebhookRouter({
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    sendMessageFn: sendMessage,
    appSecret,
  });

  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(morgan(IS_PRODUCTION ? 'combined' : 'dev'));

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/webhook', webhookLimiter, webhookRouter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use((err, _req, res, _next) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ status: 'error' });
  });

  return app;
}

const isRunDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isRunDirectly) {
  const app = buildApp();

  const server = app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[server] Webhook URL: http://localhost:${PORT}/webhook`);
  });

  const shutdown = (signal) => {
    console.log(`[server] Received ${signal}, shutting down gracefully...`);

    server.close(() => {
      console.log('[server] Closed all connections. Exiting.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[server] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { buildApp };
