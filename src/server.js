import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import {
  CLOUD_API_PROVIDER,
  createWhatsAppProvider,
} from './gateways/providerFactory.js';
import { drainKeyedQueue } from './lib/keyedQueue.js';
import { flushAllConversationCache } from './services/conversationCache.js';
import { configureErrorTracker } from './services/errorTracker.js';

const PORT = process.env.PORT || 3000;

function buildApp({
  env = process.env,
  createProviderFn = createWhatsAppProvider,
} = {}) {
  const provider = createProviderFn(env);

  configureErrorTracker({
    sendAlertFn: provider.sendMessage.rawSend,
    adminNumber: env.ADMIN_ALERT_WHATSAPP_NUMBER,
  });

  return { app: buildExpress(provider, env), provider };
}

function buildExpress(provider, env = process.env) {
  const app = express();
  const isProduction = env.NODE_ENV === 'production';

  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(morgan(isProduction ? 'combined' : 'dev'));

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

  app.use('/webhook', webhookLimiter);
  provider.attachTo(app);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use((err, _req, res, _next) => {
    console.error('[server] Unhandled error:', err);
    res.status(500).json({ status: 'error' });
  });

  return app;
}

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });

    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
  });
}

const isRunDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isRunDirectly) {
  const { app, provider } = buildApp();

  const server = app.listen(PORT, () => {
    console.log(`[server] Listening on port ${PORT}`);
    console.log(`[server] WhatsApp provider: ${provider.name}`);

    if (provider.name === CLOUD_API_PROVIDER) {
      console.log(`[server] Webhook URL: http://localhost:${PORT}/webhook`);
    }
  });

  Promise.resolve(provider.initialize?.()).catch((error) => {
    console.error('[server] WhatsApp provider initialization failed:', error);
  });

  let isShuttingDown = false;

  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[server] Received ${signal}, shutting down gracefully...`);

    const forceExitTimer = setTimeout(() => {
      console.error('[server] Forced shutdown after timeout.');
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref?.();

    try {
      await closeHttpServer(server);
    } catch (error) {
      console.error('[server] Failed to close HTTP server:', error);
    }

    try {
      await provider.drain?.();
      await drainKeyedQueue();
    } catch (error) {
      console.error('[server] Error draining tasks during shutdown:', error);
    }

    try {
      await flushAllConversationCache();
    } catch (error) {
      console.error(
        '[server] Failed to flush conversation cache during shutdown:',
        error
      );
    }

    console.log('[server] Closed all connections and flushed cache. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { buildApp, buildExpress, closeHttpServer };
