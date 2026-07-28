import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  runExclusive,
  __configureKeyedQueueForTests,
  __resetKeyedQueueForTests,
} from '../src/lib/keyedQueue.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function resolvedQuery(result = { data: null, error: null }) {
  const promise = Promise.resolve(result);
  const query = {
    eq: () => query,
    lt: () => query,
    select: () => query,
    maybeSingle: () => promise,
    then: (onFulfilled, onRejected) =>
      promise.then(onFulfilled, onRejected),
  };
  return query;
}

function createFakeLockClient({ insertError = null } = {}) {
  const deleteLock = vi.fn(() => resolvedQuery());
  const insertLock = vi.fn().mockResolvedValue({ error: insertError });
  const renewLock = vi.fn(() =>
    resolvedQuery({
      data: { lock_key: 'user-1' },
      error: null,
    }),
  );
  const from = vi.fn(() => ({
    delete: deleteLock,
    insert: insertLock,
    update: renewLock,
  }));

  return {
    client: { from },
    deleteLock,
    insertLock,
    renewLock,
  };
}

describe('runExclusive', () => {
  beforeEach(() => {
    __resetKeyedQueueForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __resetKeyedQueueForTests();
  });

  it('runs tasks for the same key one at a time, in order', async () => {
    const order = [];
    const first = deferred();

    const firstRun = runExclusive('user-1', async () => {
      order.push('first-start');
      await first.promise;
      order.push('first-end');
      return 'first-result';
    });

    const secondRun = runExclusive('user-1', async () => {
      order.push('second-start');
      return 'second-result';
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first-start']);

    first.resolve();

    const [firstResult, secondResult] = await Promise.all([
      firstRun,
      secondRun,
    ]);

    expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    expect(firstResult).toBe('first-result');
    expect(secondResult).toBe('second-result');
  });

  it('runs tasks for different keys concurrently', async () => {
    const order = [];
    const userA = deferred();

    const runA = runExclusive('user-a', async () => {
      order.push('a-start');
      await userA.promise;
      order.push('a-end');
    });

    const runB = runExclusive('user-b', async () => {
      order.push('b-start');
      order.push('b-end');
    });

    await runB;
    expect(order).toEqual(['a-start', 'b-start', 'b-end']);

    userA.resolve();
    await runA;
    expect(order).toEqual(['a-start', 'b-start', 'b-end', 'a-end']);
  });

  it('lets later tasks run even if an earlier task for the same key throws', async () => {
    const failingRun = runExclusive('user-1', async () => {
      throw new Error('boom');
    });

    await expect(failingRun).rejects.toThrow('boom');

    const nextRun = runExclusive('user-1', async () => 'still works');
    await expect(nextRun).resolves.toBe('still works');
  });

  it('propagates each task result/error to its own caller only', async () => {
    const okRun = runExclusive('user-1', async () => 'ok');
    const failRun = runExclusive('user-1', async () => {
      throw new Error('nope');
    });

    await expect(okRun).resolves.toBe('ok');
    await expect(failRun).rejects.toThrow('nope');
  });

  it('drainKeyedQueue waits for all active and queued tasks to settle', async () => {
    const d1 = deferred();
    const d2 = deferred();

    const p1 = runExclusive('key-1', () => d1.promise);
    const p2 = runExclusive('key-2', () => d2.promise);

    let drained = false;
    const drainPromise = (async () => {
      const { drainKeyedQueue } = await import('../src/lib/keyedQueue.js');
      await drainKeyedQueue();
      drained = true;
    })();

    await Promise.resolve();
    expect(drained).toBe(false);

    d1.resolve('v1');
    d2.resolve('v2');

    await Promise.all([p1, p2]);
    await drainPromise;

    expect(drained).toBe(true);
  });

  it('does not run the task when the distributed lock cannot be acquired', async () => {
    const backendError = {
      code: 'LOCK_BACKEND_DOWN',
      message: 'lock service unavailable',
    };
    const { client } = createFakeLockClient({
      insertError: backendError,
    });
    const task = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __configureKeyedQueueForTests({ supabaseClient: client });

    await expect(runExclusive('user-1', task)).rejects.toBe(backendError);
    expect(task).not.toHaveBeenCalled();
  });

  it('times out without running the task when another process holds the lock', async () => {
    vi.useFakeTimers();
    const { client } = createFakeLockClient({
      insertError: { code: '23505', message: 'duplicate key' },
    });
    const task = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    __configureKeyedQueueForTests({
      supabaseClient: client,
      waitTimeoutMs: 10,
      pollIntervalMs: 2,
    });

    const run = runExclusive('user-1', task);
    const rejection = expect(run).rejects.toMatchObject({
      code: 'DISTRIBUTED_LOCK_TIMEOUT',
    });

    await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(task).not.toHaveBeenCalled();
  });

  it('renews the distributed lock while a long task is running', async () => {
    vi.useFakeTimers();
    const { client, deleteLock, insertLock, renewLock } =
      createFakeLockClient();
    const longTask = deferred();
    __configureKeyedQueueForTests({
      supabaseClient: client,
      ttlMs: 30,
      renewIntervalMs: 5,
    });

    const run = runExclusive('user-1', () => longTask.promise);
    await vi.advanceTimersByTimeAsync(6);

    expect(insertLock).toHaveBeenCalledTimes(1);
    expect(renewLock).toHaveBeenCalled();

    longTask.resolve('done');
    await expect(run).resolves.toBe('done');
    expect(deleteLock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
