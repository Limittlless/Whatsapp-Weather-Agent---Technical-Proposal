import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createCloudApiWebhookRouter } from '../src/gateways/cloudApiWebhook.js';

function buildTestApp({
  runAgentFn,
  sendMessageFn,
  claimMessageFn,
  appSecret,
  verifyToken = 'perf-verify-token',
} = {}) {
  const app = express();
  app.use(
    express.json({
      limit: '1mb',
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

function textMessagePayload({ from, id, body }) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                { id, from, type: 'text', text: { body } },
              ],
            },
          },
        ],
      },
    ],
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil((p / 100) * sortedValues.length) - 1
  );
  return sortedValues[index];
}

async function timeRequest(app, payload) {
  const start = process.hrtime.bigint();
  const response = await request(app).post('/webhook').send(payload);
  const end = process.hrtime.bigint();
  return { response, durationMs: Number(end - start) / 1e6 };
}

describe('webhook performance', () => {
  it('acknowledges Meta in well under a second, even when the agent is slow', async () => {
    const runAgentFn = vi.fn().mockImplementation(async () => {
      await delay(2000);
      return 'Slow but eventual reply';
    });
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    const claimMessageFn = vi.fn().mockResolvedValue(true);
    const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

    const payload = textMessagePayload({
      from: '212600000001',
      id: 'perf-ack-1',
      body: 'What is the weather in Agadir?',
    });

    const { response, durationMs } = await timeRequest(app, payload);

    expect(response.status).toBe(200);
    expect(durationMs).toBeLessThan(500);
  });

  it('sustains p95 ack latency under a concurrent burst of webhook deliveries', async () => {
    const CONCURRENCY = 50;
    const AGENT_LATENCY_MS = 50;

    const runAgentFn = vi.fn().mockImplementation(async () => {
      await delay(AGENT_LATENCY_MS);
      return 'Reply';
    });
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    const claimMessageFn = vi.fn().mockResolvedValue(true);
    const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

    const requests = Array.from({ length: CONCURRENCY }, (_, i) =>
      timeRequest(
        app,
        textMessagePayload({
          from: `21260000${String(i).padStart(4, '0')}`,
          id: `perf-burst-${i}`,
          body: 'Weather in Casablanca?',
        })
      )
    );

    const results = await Promise.all(requests);

    for (const { response } of results) {
      expect(response.status).toBe(200);
    }

    const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
    const p50 = percentile(durations, 50);
    const p95 = percentile(durations, 95);
    const max = durations[durations.length - 1];

    console.log(
      `[perf] burst of ${CONCURRENCY}: p50=${p50.toFixed(1)}ms ` +
        `p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms`
    );

    expect(p50).toBeLessThan(650);
    expect(p95).toBeLessThan(800);
  });

  it('rejects unsigned requests fast, without invoking the agent (signature check is cheap)', async () => {
    const appSecret = 'perf-app-secret';
    const runAgentFn = vi.fn();
    const sendMessageFn = vi.fn();
    const app = buildTestApp({ runAgentFn, sendMessageFn, appSecret });

    const { response, durationMs } = await timeRequest(app, { entry: [] });

    expect(response.status).toBe(401);
    expect(runAgentFn).not.toHaveBeenCalled();
    expect(durationMs).toBeLessThan(200);
  });

  it('signature verification overhead stays negligible under load', async () => {
    const ITERATIONS = 200;
    const appSecret = 'perf-app-secret';
    const runAgentFn = vi.fn().mockResolvedValue('ok');
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    const claimMessageFn = vi.fn().mockResolvedValue(true);
    const app = buildTestApp({
      runAgentFn,
      sendMessageFn,
      claimMessageFn,
      appSecret,
    });

    const payload = textMessagePayload({
      from: '212600009999',
      id: 'perf-sig-1',
      body: 'Hi',
    });
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERATIONS; i += 1) {
      const response = await request(app)
        .post('/webhook')
        .set('X-Hub-Signature-256', signature)
        .set('Content-Type', 'application/json')
        .send(rawBody.toString('utf8'));
      expect(response.status).toBe(200);
    }
    const totalMs = Number(process.hrtime.bigint() - start) / 1e6;
    const avgMs = totalMs / ITERATIONS;

    console.log(
      `[perf] ${ITERATIONS} signed requests: total=${totalMs.toFixed(1)}ms ` +
        `avg=${avgMs.toFixed(2)}ms/req`
    );

    expect(avgMs).toBeLessThan(50);
  });

  it('claimMessageFn dedupe check does not add meaningful latency', async () => {
    const runAgentFn = vi.fn().mockResolvedValue('ok');
    const sendMessageFn = vi.fn().mockResolvedValue(undefined);
    const claimMessageFn = vi.fn().mockResolvedValue(false);
    const app = buildTestApp({ runAgentFn, sendMessageFn, claimMessageFn });

    const payload = textMessagePayload({
      from: '212600007777',
      id: 'perf-dupe-1',
      body: 'Hi again',
    });

    const { response, durationMs } = await timeRequest(app, payload);

    expect(response.status).toBe(200);
    expect(durationMs).toBeLessThan(200);
  });
});
