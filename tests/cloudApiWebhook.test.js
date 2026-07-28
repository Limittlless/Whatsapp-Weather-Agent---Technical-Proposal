import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCloudApiWebhookRouter } from '../src/gateways/cloudApiWebhook.js';

function buildTestApp({
  runAgentFn,
  sendMessageFn,
  claimMessageFn,
  isAuthorizedFn = vi.fn().mockResolvedValue(true),
  executeAdminCommandFn,
  appSecret,
  verifyToken = 'test-verify-token',
}) {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(
    '/webhook',
    createCloudApiWebhookRouter({
      verifyToken,
      runAgentFn,
      sendMessageFn,
      claimMessageFn,
      isAuthorizedFn,
      executeAdminCommandFn,
      appSecret,
    })
  );
  return app;
}

function createTextPayload({
  from = '212600000000',
  body = 'Hello',
  id = 'message-1',
} = {}) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id,
                  from,
                  type: 'text',
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('createCloudApiWebhookRouter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when created without a verifyToken', () => {
    expect(() =>
      createCloudApiWebhookRouter({ sendMessageFn: vi.fn() })
    ).toThrow('verifyToken is required');
  });

  it('throws when created without a sendMessageFn', () => {
    expect(() =>
      createCloudApiWebhookRouter({ verifyToken: 'abc' })
    ).toThrow('sendMessageFn is required');
  });

  describe('GET / (verification handshake)', () => {
    it('returns the challenge when the mode and token are correct', async () => {
      const app = buildTestApp({ sendMessageFn: vi.fn() });

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': '12345',
        });

      expect(response.status).toBe(200);
      expect(response.text).toBe('12345');
    });

    it('rejects with 403 when the token is wrong', async () => {
      const app = buildTestApp({ sendMessageFn: vi.fn() });

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token',
          'hub.challenge': '12345',
        });

      expect(response.status).toBe(403);
    });

    it('rejects with 403 when the mode is not "subscribe"', async () => {
      const app = buildTestApp({ sendMessageFn: vi.fn() });

      const response = await request(app)
        .get('/webhook')
        .query({
          'hub.mode': 'something-else',
          'hub.verify_token': 'test-verify-token',
          'hub.challenge': '12345',
        });

      expect(response.status).toBe(403);
    });
  });

  describe('POST / (incoming messages)', () => {
    it('acknowledges immediately with 200', async () => {
      const runAgentFn = vi.fn().mockResolvedValue('Hi there!');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const app = buildTestApp({ runAgentFn, sendMessageFn });

      const response = await request(app).post('/webhook').send({ entry: [] });

      expect(response.status).toBe(200);
    });

    it('runs the agent and sends the reply for a text message', async () => {
      const runAgentFn = vi.fn().mockResolvedValue('It is 30°C in Agadir.');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const app = buildTestApp({ runAgentFn, sendMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '212600000000',
                      type: 'text',
                      text: { body: 'What is the weather in Agadir?' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledWith({
        whatsappId: '212600000000',
        userMessage: 'What is the weather in Agadir?',
      });
      expect(sendMessageFn).toHaveBeenCalledWith(
        '212600000000',
        'It is 30°C in Agadir.'
      );
    });

    it('skips non-text messages without calling the agent', async () => {
      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn();
      const app = buildTestApp({ runAgentFn, sendMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '212600000000', type: 'image' },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).not.toHaveBeenCalled();
    });

    it('handles multiple messages in a single webhook batch', async () => {
      const runAgentFn = vi
        .fn()
        .mockResolvedValueOnce('Reply 1')
        .mockResolvedValueOnce('Reply 2');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const app = buildTestApp({ runAgentFn, sendMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: '111',
                      type: 'text',
                      text: { body: 'Hi' },
                    },
                    {
                      from: '222',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledTimes(2);
      expect(sendMessageFn).toHaveBeenNthCalledWith(1, '111', 'Reply 1');
      expect(sendMessageFn).toHaveBeenNthCalledWith(2, '222', 'Reply 2');
    });

    it('does not crash the request when sendMessageFn fails', async () => {
      const runAgentFn = vi.fn().mockResolvedValue('Some reply');
      const sendMessageFn = vi
        .fn()
        .mockRejectedValue(new Error('Cloud API is down'));
      const app = buildTestApp({ runAgentFn, sendMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    { from: '212600000000', type: 'text', text: { body: 'Hi' } },
                  ],
                },
              },
            ],
          },
        ],
      };

      const response = await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response.status).toBe(200);
    });

    it('sends a retry reply when the agent task fails', async () => {
      const runAgentFn = vi
        .fn()
        .mockRejectedValue(new Error('lock timeout'));
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
      });

      await request(app)
        .post('/webhook')
        .send(createTextPayload({ id: 'lock-timeout-1' }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(sendMessageFn).toHaveBeenCalledTimes(1);
      expect(sendMessageFn.mock.calls[0][1]).toContain(
        'Please try again shortly',
      );
    });

    it('skips the agent when claimMessageFn reports a duplicate', async () => {
      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn();
      const claimMessageFn = vi.fn().mockResolvedValue(false);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'wamid.duplicate',
                      from: '212600000000',
                      type: 'text',
                      text: { body: 'Hi again' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(claimMessageFn).toHaveBeenCalledWith(
        'wamid.duplicate',
        '212600000000'
      );
      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).not.toHaveBeenCalled();
    });
  });

  describe('user authorization gate', () => {
    const ORIGINAL_ADMIN_ENV = process.env.ADMIN_WHATSAPP_NUMBERS;

    afterEach(() => {
      if (ORIGINAL_ADMIN_ENV === undefined) {
        delete process.env.ADMIN_WHATSAPP_NUMBERS;
      } else {
        process.env.ADMIN_WHATSAPP_NUMBERS = ORIGINAL_ADMIN_ENV;
      }
    });

    it('blocks an unauthorized user before invoking the agent', async () => {
      delete process.env.ADMIN_WHATSAPP_NUMBERS;

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi.fn().mockResolvedValue(false);
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
      });

      await request(app)
        .post('/webhook')
        .send(createTextPayload({ from: '212699999999' }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(isAuthorizedFn).toHaveBeenCalledWith('212699999999');
      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).toHaveBeenCalledTimes(1);
      expect(sendMessageFn.mock.calls[0][1]).toContain('not authorized');
    });

    it('allows an authorized user to reach the agent', async () => {
      delete process.env.ADMIN_WHATSAPP_NUMBERS;

      const runAgentFn = vi.fn().mockResolvedValue('Authorized reply');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
      });

      await request(app)
        .post('/webhook')
        .send(createTextPayload({ from: '212688888888' }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledWith({
        whatsappId: '212688888888',
        userMessage: 'Hello',
      });
      expect(sendMessageFn).toHaveBeenCalledWith(
        '212688888888',
        'Authorized reply'
      );
    });

    it('fails closed when the authorization service is unavailable', async () => {
      delete process.env.ADMIN_WHATSAPP_NUMBERS;

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi
        .fn()
        .mockRejectedValue(new Error('Supabase unavailable'));
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
      });

      await request(app).post('/webhook').send(createTextPayload());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).toHaveBeenCalledTimes(1);
      expect(sendMessageFn.mock.calls[0][1]).toContain(
        'Could not verify access'
      );
    });

    it('lets configured admins use the agent without a database authorization row', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn().mockResolvedValue('Admin reply');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi.fn().mockResolvedValue(false);
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
      });

      await request(app).post('/webhook').send(createTextPayload());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(isAuthorizedFn).not.toHaveBeenCalled();
      expect(runAgentFn).toHaveBeenCalledTimes(1);
    });

    it('passes the admin WhatsApp ID into an auth command', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi.fn();
      const executeAdminCommandFn = vi
        .fn()
        .mockResolvedValue('Authorization list');
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
        executeAdminCommandFn,
      });

      await request(app)
        .post('/webhook')
        .send(createTextPayload({ body: '/auth list' }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeAdminCommandFn).toHaveBeenCalledWith('/auth list', {
        adminWhatsappId: '212600000000',
      });
      expect(isAuthorizedFn).not.toHaveBeenCalled();
      expect(runAgentFn).not.toHaveBeenCalled();
    });

    it('never executes an auth command from a non-admin number', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const isAuthorizedFn = vi.fn().mockResolvedValue(false);
      const executeAdminCommandFn = vi.fn();
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        claimMessageFn,
        isAuthorizedFn,
        executeAdminCommandFn,
      });

      await request(app)
        .post('/webhook')
        .send(
          createTextPayload({
            from: '212699999999',
            body: '/auth add 212688888888',
          })
        );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeAdminCommandFn).not.toHaveBeenCalled();
      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn.mock.calls[0][1]).toContain('not authorized');
    });
  });

  describe('signature verification', () => {
    it('rejects a POST with an invalid signature when appSecret is set', async () => {
      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn();
      const app = buildTestApp({
        runAgentFn,
        sendMessageFn,
        appSecret: 'test-app-secret',
      });

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', 'sha256=not-a-real-signature')
        .send({ entry: [] });

      expect(response.status).toBe(401);
      expect(runAgentFn).not.toHaveBeenCalled();
    });

    it('accepts a POST with a correctly signed body', async () => {
      const runAgentFn = vi.fn().mockResolvedValue('Sunny today.');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const appSecret = 'test-app-secret';
      const app = buildTestApp({ runAgentFn, sendMessageFn, appSecret });

      const payload = { entry: [] };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody.toString('utf8'));

      expect(response.status).toBe(200);
    });
  });

  describe('admin direct commands', () => {
    const ORIGINAL_ADMIN_ENV = process.env.ADMIN_WHATSAPP_NUMBERS;

    afterEach(() => {
      if (ORIGINAL_ADMIN_ENV === undefined) {
        delete process.env.ADMIN_WHATSAPP_NUMBERS;
      } else {
        process.env.ADMIN_WHATSAPP_NUMBERS = ORIGINAL_ADMIN_ENV;
      }
    });

    it('runs a "/"-prefixed command directly for an admin number, without calling the agent', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'admin-cmd-1',
                      from: '212600000000',
                      type: 'text',
                      text: { body: '/uptime' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).toHaveBeenCalledTimes(1);
      const [to, body] = sendMessageFn.mock.calls[0];
      expect(to).toBe('212600000000');
      expect(body).toContain('مدة تشغيل الخادم');
    });

    it('falls through to the normal agent for a "/"-prefixed message from a non-admin number', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn().mockResolvedValue('Just a normal reply');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'not-admin-1',
                      from: '212699999999',
                      type: 'text',
                      text: { body: '/uptime' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledWith({
        whatsappId: '212699999999',
        userMessage: '/uptime',
      });
      expect(sendMessageFn).toHaveBeenCalledWith(
        '212699999999',
        'Just a normal reply'
      );
    });

    it('falls through to the normal agent for a non-"/" message from an admin number', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000';

      const runAgentFn = vi.fn().mockResolvedValue('Weather reply');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'admin-normal-1',
                      from: '212600000000',
                      type: 'text',
                      text: { body: 'What is the weather in Rabat?' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledWith({
        whatsappId: '212600000000',
        userMessage: 'What is the weather in Rabat?',
      });
      expect(sendMessageFn).toHaveBeenCalledWith(
        '212600000000',
        'Weather reply'
      );
    });

    it('supports multiple admin numbers', async () => {
      process.env.ADMIN_WHATSAPP_NUMBERS = '212600000000,212611111111';

      const runAgentFn = vi.fn();
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'admin-cmd-2',
                      from: '212611111111',
                      type: 'text',
                      text: { body: '/help' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).not.toHaveBeenCalled();
      expect(sendMessageFn).toHaveBeenCalledTimes(1);
    });

    it('does not run admin commands at all when ADMIN_WHATSAPP_NUMBERS is unset', async () => {
      delete process.env.ADMIN_WHATSAPP_NUMBERS;

      const runAgentFn = vi.fn().mockResolvedValue('Normal reply');
      const sendMessageFn = vi.fn().mockResolvedValue(undefined);
      const claimMessageFn = vi.fn().mockResolvedValue(true);
      const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

      const payload = {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      id: 'no-admins-1',
                      from: '212600000000',
                      type: 'text',
                      text: { body: '/status' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await request(app).post('/webhook').send(payload);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runAgentFn).toHaveBeenCalledWith({
        whatsappId: '212600000000',
        userMessage: '/status',
      });
      expect(sendMessageFn).toHaveBeenCalledWith(
        '212600000000',
        'Normal reply'
      );
    });
  });
});
