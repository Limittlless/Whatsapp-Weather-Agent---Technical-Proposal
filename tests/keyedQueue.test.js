import { describe, it, expect, beforeEach } from 'vitest';

import {
  runExclusive,
  __resetKeyedQueueForTests,
} from '../src/lib/keyedQueue.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('runExclusive', () => {
  beforeEach(() => {
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
});
