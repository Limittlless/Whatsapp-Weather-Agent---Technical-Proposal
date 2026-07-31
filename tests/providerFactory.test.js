import { describe, expect, it, vi } from 'vitest';

import {
  CLOUD_API_PROVIDER,
  WEB_JS_PROVIDER,
  createWhatsAppProvider,
} from '../src/gateways/providerFactory.js';

function createCloudEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
    WHATSAPP_CLOUD_API_TOKEN: 'access-token',
    WHATSAPP_VERIFY_TOKEN: 'verify-token',
    ...overrides,
  };
}

describe('createWhatsAppProvider', () => {
  it('uses Cloud API when WHATSAPP_PROVIDER is unset', () => {
    const provider = createWhatsAppProvider(createCloudEnv());
    const app = { use: vi.fn() };

    provider.attachTo(app);

    expect(provider.name).toBe(CLOUD_API_PROVIDER);
    expect(typeof provider.sendMessage).toBe('function');
    expect(typeof provider.sendMessage.rawSend).toBe('function');
    expect(app.use).toHaveBeenCalledWith(
      '/webhook',
      expect.any(Function),
    );
  });

  it('selects web_js without requiring Cloud API credentials', () => {
    const provider = createWhatsAppProvider({
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: WEB_JS_PROVIDER,
    });

    expect(provider.name).toBe(WEB_JS_PROVIDER);
    expect(typeof provider.initialize).toBe('function');
    expect(typeof provider.drain).toBe('function');
  });

  it('requires the Meta app secret only for production Cloud API', () => {
    expect(() =>
      createWhatsAppProvider(
        createCloudEnv({
          NODE_ENV: 'production',
          WHATSAPP_PROVIDER: CLOUD_API_PROVIDER,
        }),
      ),
    ).toThrow('WHATSAPP_APP_SECRET is required');
  });

  it('rejects an unknown provider name', () => {
    expect(() =>
      createWhatsAppProvider({
        WHATSAPP_PROVIDER: 'typo',
      }),
    ).toThrow('Unsupported WHATSAPP_PROVIDER');
  });
});
