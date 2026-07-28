import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/agent/runAgent.js', () => ({ runAgent: vi.fn() }));
vi.mock('../src/services/processedMessages.js', () => ({
  claimMessage: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/middleware/verifyMetaSignature.js', () => ({
  createMetaSignatureVerifier: () => (_req, _res, next) => next(),
}));
vi.mock('../src/services/adminAuth.js', () => ({
  isAdminNumber: vi.fn().mockReturnValue(false),
}));
vi.mock('../src/services/userAuthorization.js', () => ({
  isUserAuthorized: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/services/adminCommands.js', () => ({
  isAdminCommandMessage: vi.fn().mockReturnValue(false),
  executeAdminCommand: vi.fn(),
}));

import { createCloudApiWebhookRouter } from '../src/gateways/cloudApiWebhook.js';
import { closeHttpServer } from '../src/server.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildRouter(runAgentFn) {
  return createCloudApiWebhookRouter({
    verifyToken: 'test-token',
    sendMessageFn: vi.fn().mockResolvedValue(undefined),
    runAgentFn,
  });
}

function fireWebhookPost(router, entries) {
  const req = {
    body: { entry: entries },
    rawBody: Buffer.from('{}'),
    headers: {},
    query: {},
    ip: '127.0.0.1',
  };
  const res = { sendStatus: vi.fn() };
  const next = vi.fn();

  router.stack
    .filter((layer) => layer.route?.path === '/')
    .forEach((layer) => {
      layer.route.stack.forEach((l) => {
        l.handle(req, res, next);
      });
    });
}

describe('cloudApiWebhookRouter.drain()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves immediately when no tasks are active', async () => {
    const router = buildRouter(vi.fn().mockResolvedValue('reply'));
    await expect(router.drain()).resolves.toEqual([]);
  });

  it('resolves only after all active tasks have settled', async () => {
    const agentDeferred = deferred();
    const runAgentFn = vi.fn().mockReturnValue(agentDeferred.promise);
    const router = buildRouter(runAgentFn);

    const entries = [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  type: 'text',
                  from: '971000000001',
                  id: 'msg-1',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ];

    fireWebhookPost(router, entries);

    await new Promise((r) => setTimeout(r, 20));

    let drained = false;
    const drainPromise = router.drain().then(() => {
      drained = true;
    });

    await Promise.resolve();
    expect(drained).toBe(false);

    agentDeferred.resolve('Weather: sunny');

    await drainPromise;
    expect(drained).toBe(true);
  });

  it('drain() resolves even if a task rejects (allSettled semantics)', async () => {
    const agentDeferred = deferred();
    const runAgentFn = vi.fn().mockReturnValue(agentDeferred.promise);
    const router = buildRouter(runAgentFn);

    const entries = [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  type: 'text',
                  from: '971000000002',
                  id: 'msg-2',
                  text: { body: 'hi' },
                },
              ],
            },
          },
        ],
      },
    ];

    fireWebhookPost(router, entries);
    await new Promise((r) => setTimeout(r, 20));

    const drainPromise = router.drain();

    agentDeferred.reject(new Error('agent crashed'));

    await expect(drainPromise).resolves.toBeDefined();
  });

  it('removes a task from the active set after it settles', async () => {
    const agentDeferred = deferred();
    const runAgentFn = vi.fn().mockReturnValue(agentDeferred.promise);
    const router = buildRouter(runAgentFn);

    const entries = [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  type: 'text',
                  from: '971000000003',
                  id: 'msg-3',
                  text: { body: 'test' },
                },
              ],
            },
          },
        ],
      },
    ];

    fireWebhookPost(router, entries);
    await new Promise((r) => setTimeout(r, 20));

    agentDeferred.resolve('done');
    await router.drain();

    const results = await router.drain();
    expect(results).toEqual([]);
  });
});

describe('closeHttpServer', () => {
  it('waits for active HTTP requests to finish', async () => {
    let closeCallback;
    const server = {
      close: vi.fn((callback) => {
        closeCallback = callback;
      }),
      closeIdleConnections: vi.fn(),
    };

    let closed = false;
    const closePromise = closeHttpServer(server).then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);

    closeCallback();
    await closePromise;
    expect(closed).toBe(true);
  });
});
