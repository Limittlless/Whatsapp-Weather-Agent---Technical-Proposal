import { createCloudApiSender } from './cloudApiClient.js';
import { createCloudApiWebhookRouter } from './cloudApiWebhook.js';
import { createWebJsProvider } from './webJsGateway.js';

export const CLOUD_API_PROVIDER = 'cloud_api';
export const WEB_JS_PROVIDER = 'web_js';

export function createCloudApiProvider(env = process.env) {
  const appSecret = env.WHATSAPP_APP_SECRET;

  if (env.NODE_ENV === 'production' && !appSecret?.trim()) {
    throw new Error(
      'WHATSAPP_APP_SECRET is required for the cloud_api provider when ' +
        'NODE_ENV=production. Set it in Railway\'s Variables tab.',
    );
  }

  const sendMessage = createCloudApiSender({
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: env.WHATSAPP_CLOUD_API_TOKEN,
  });

  const webhookRouter = createCloudApiWebhookRouter({
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    sendMessageFn: sendMessage,
    appSecret,
  });

  return {
    name: CLOUD_API_PROVIDER,
    sendMessage,
    attachTo(app) {
      app.use('/webhook', webhookRouter);
    },
    async initialize() {},
    drain() {
      return webhookRouter.drain();
    },
  };
}

export function createWhatsAppProvider(env = process.env) {
  const providerName =
    env.WHATSAPP_PROVIDER?.trim() || CLOUD_API_PROVIDER;

  if (providerName === WEB_JS_PROVIDER) {
    return createWebJsProvider(env);
  }

  if (providerName === CLOUD_API_PROVIDER) {
    return createCloudApiProvider(env);
  }

  throw new Error(
    `Unsupported WHATSAPP_PROVIDER "${providerName}". ` +
      `Expected "${CLOUD_API_PROVIDER}" or "${WEB_JS_PROVIDER}".`,
  );
}
