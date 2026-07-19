import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCloudApiWebhookRouter } from '../src/gateways/cloudApiWebhook.js';

function buildTestApp({
  runAgentFn,
  sendMessageFn,
  claimMessageFn,
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
      appSecret,
    })
  );
  return app;
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
        .send(rawBody);

      expect(response.status).toBe(200);
    });
  });
});
