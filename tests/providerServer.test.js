import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

import { buildApp } from '../src/server.js';

describe('server provider integration', () => {
  it('attaches the selected provider and exposes it for startup/shutdown', async () => {
    const attachTo = vi.fn((app) => {
      app.get('/provider-test', (_req, res) => {
        res.status(200).send('attached');
      });
    });
    const sendMessage = vi.fn();
    sendMessage.rawSend = vi.fn();
    const provider = {
      name: 'test_provider',
      sendMessage,
      attachTo,
      initialize: vi.fn(),
      drain: vi.fn(),
    };
    const createProviderFn = vi.fn().mockReturnValue(provider);
    const { app, provider: selectedProvider } = buildApp({
      env: { NODE_ENV: 'test' },
      createProviderFn,
    });

    expect(selectedProvider).toBe(provider);
    expect(attachTo).toHaveBeenCalledTimes(1);
    await request(app).get('/provider-test').expect(200, 'attached');
    await request(app)
      .get('/health')
      .expect(200, { status: 'ok' });
  });
});
