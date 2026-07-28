import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/services/conversationStore.js', () => ({
  getConversationHistory: vi.fn(),
  saveConversationHistory: vi.fn(),
}));

vi.mock('../src/services/errorTracker.js', () => ({
  trackError: vi.fn(),
}));

import {
  getConversationHistory,
  saveConversationHistory,
} from '../src/services/conversationStore.js';
import { trackError } from '../src/services/errorTracker.js';
import {
  getCachedConversationHistory,
  setCachedConversationHistory,
  flushConversationHistory,
  flushAllConversationCache,
  __configureConversationCacheForTests,
  __resetConversationCacheForTests,
} from '../src/services/conversationCache.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('conversationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConversationCacheForTests();
    getConversationHistory.mockResolvedValue([]);
    saveConversationHistory.mockResolvedValue(undefined);
  });

  it('reads through to conversationStore the first time a user is seen', async () => {
    getConversationHistory.mockResolvedValue([
      { role: 'user', content: 'hi' },
    ]);

    const history = await getCachedConversationHistory('212600000000');

    expect(history).toEqual([{ role: 'user', content: 'hi' }]);
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
  });

  it('returns a just-written turn immediately, without re-reading the store', async () => {
    await getCachedConversationHistory('212600000000');

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'first message' },
    ]);

    const history = await getCachedConversationHistory('212600000000');

    expect(history).toEqual([{ role: 'user', content: 'first message' }]);
    expect(getConversationHistory).toHaveBeenCalledTimes(1);
  });

  it('persists a write in the background without the caller waiting for it', () => {
    const pendingSave = deferred();
    saveConversationHistory.mockReturnValue(pendingSave.promise);

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'hi' },
    ]);

    expect(saveConversationHistory).toHaveBeenCalledWith(
      '212600000000',
      [{ role: 'user', content: 'hi' }],
    );

    pendingSave.resolve();
  });

  it('never lets an older save overwrite a newer one when writes race', async () => {
    const firstSave = deferred();
    const secondSave = deferred();

    saveConversationHistory
      .mockReturnValueOnce(firstSave.promise)
      .mockReturnValueOnce(secondSave.promise);

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'message 1' },
    ]);

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'message 1' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'message 2' },
    ]);

    expect(saveConversationHistory).toHaveBeenCalledTimes(1);

    firstSave.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(saveConversationHistory).toHaveBeenCalledTimes(2);
    expect(saveConversationHistory).toHaveBeenLastCalledWith(
      '212600000000',
      [
        { role: 'user', content: 'message 1' },
        { role: 'assistant', content: 'reply 1' },
        { role: 'user', content: 'message 2' },
      ],
    );

    secondSave.resolve();
    await flushConversationHistory('212600000000');
  });

  it('keeps a failed write dirty so it gets retried, and reports the failure', async () => {
    saveConversationHistory.mockRejectedValueOnce(new Error('network blip'));
    saveConversationHistory.mockResolvedValueOnce(undefined);

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'hi' },
    ]);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(trackError).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'conversationCache' }),
    );

    await flushConversationHistory('212600000000');
    expect(saveConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('flushAllConversationCache waits for every pending write', async () => {
    saveConversationHistory.mockResolvedValue(undefined);

    setCachedConversationHistory('user-a', [{ role: 'user', content: 'a' }]);
    setCachedConversationHistory('user-b', [{ role: 'user', content: 'b' }]);

    await flushAllConversationCache();

    expect(saveConversationHistory).toHaveBeenCalledWith('user-a', [
      { role: 'user', content: 'a' },
    ]);
    expect(saveConversationHistory).toHaveBeenCalledWith('user-b', [
      { role: 'user', content: 'b' },
    ]);
  });

  it('evicts an idle conversation after its TTL, flushing first if needed', async () => {
    vi.useFakeTimers();
    __configureConversationCacheForTests({ idleTtlMs: 50 });

    try {
      await getCachedConversationHistory('212600000000');
      setCachedConversationHistory('212600000000', [
        { role: 'user', content: 'hi' },
      ]);

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);

      getConversationHistory.mockClear();
      getConversationHistory.mockResolvedValue([
        { role: 'user', content: 'hi' },
      ]);

      await getCachedConversationHistory('212600000000');
      expect(getConversationHistory).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushConversationHistory throws when a save fails and the entry is still dirty', async () => {
    saveConversationHistory.mockRejectedValue(new Error('disk full'));

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'hi' },
    ]);

    await expect(
      flushConversationHistory('212600000000'),
    ).rejects.toThrow('last save attempt was unsuccessful');
  });

  it('does not replace dirty local history during a forced refresh', async () => {
    getConversationHistory.mockResolvedValue([]);
    await getCachedConversationHistory('212600000000');
    saveConversationHistory.mockRejectedValue(new Error('disk full'));

    const unsavedHistory = [{ role: 'user', content: 'keep this message' }];
    setCachedConversationHistory('212600000000', unsavedHistory);
    await expect(
      flushConversationHistory('212600000000'),
    ).rejects.toThrow('last save attempt was unsuccessful');

    getConversationHistory.mockResolvedValue([]);

    const history = await getCachedConversationHistory('212600000000', {
      forceRefresh: true,
    });

    expect(history).toEqual(unsavedHistory);
    expect(getConversationHistory).toHaveBeenCalledTimes(2);
  });

  it('does not overwrite newer stored history with a stale dirty cache', async () => {
    getConversationHistory.mockResolvedValue([]);
    await getCachedConversationHistory('212600000000');
    saveConversationHistory.mockRejectedValue(new Error('network down'));

    setCachedConversationHistory('212600000000', [
      { role: 'user', content: 'unsaved local message' },
    ]);
    await expect(
      flushConversationHistory('212600000000'),
    ).rejects.toThrow('last save attempt was unsuccessful');

    const newerStoredHistory = [
      { role: 'user', content: 'message saved by another app instance' },
    ];
    getConversationHistory.mockResolvedValue(newerStoredHistory);

    const history = await getCachedConversationHistory('212600000000', {
      forceRefresh: true,
    });

    expect(history).toEqual(newerStoredHistory);
    expect(trackError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          stage: 'dirtyRefreshConflict',
        }),
      }),
    );

    const saveAttempts = saveConversationHistory.mock.calls.length;
    await flushConversationHistory('212600000000');
    expect(saveConversationHistory).toHaveBeenCalledTimes(saveAttempts);
  });

  it('passes the active distributed lock to the history store', async () => {
    const lock = {
      key: '212600000000',
      ownerId: 'owner-1',
      assertLockHeld: vi.fn(),
    };

    setCachedConversationHistory(
      '212600000000',
      [{ role: 'user', content: 'hi' }],
      { lock },
    );
    await flushConversationHistory('212600000000');

    expect(saveConversationHistory).toHaveBeenCalledWith(
      '212600000000',
      [{ role: 'user', content: 'hi' }],
      { lock },
    );
  });

  it('flushAllConversationCache rejects with an aggregated error when any flush fails', async () => {
    saveConversationHistory
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('quota exceeded'));

    setCachedConversationHistory('user-a', [{ role: 'user', content: 'a' }]);
    setCachedConversationHistory('user-b', [{ role: 'user', content: 'b' }]);

    await expect(flushAllConversationCache()).rejects.toThrow(
      'flushAllConversationCache: 1 flush(es) failed',
    );
  });
});
