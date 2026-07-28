import { isDeepStrictEqual } from 'node:util';

import {
  getConversationHistory,
  saveConversationHistory,
} from './conversationStore.js';
import { trackError } from './errorTracker.js';

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const cache = new Map();

let sweepTimer = null;
let idleTtlMs = DEFAULT_IDLE_TTL_MS;

function getOrCreateEntry(whatsappId, initialHistory) {
  let entry = cache.get(whatsappId);
  if (!entry) {
    entry = {
      history: initialHistory,
      persistedHistory: initialHistory,
      dirty: false,
      lastAccessAt: Date.now(),
      flushInFlight: false,
      lock: null,
    };
    cache.set(whatsappId, entry);
  }
  return entry;
}

export async function getCachedConversationHistory(
  whatsappId,
  { forceRefresh = false } = {},
) {
  const cached = cache.get(whatsappId);

  if (cached && !forceRefresh) {
    cached.lastAccessAt = Date.now();
    return cached.history;
  }

  if (cached?.flushInFlight) {
    while (cached.flushInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const history = await getConversationHistory(whatsappId);
  const entry = getOrCreateEntry(whatsappId, history);

  if (entry.dirty) {
    if (isDeepStrictEqual(history, entry.history)) {
      entry.persistedHistory = history;
      entry.dirty = false;
      entry.lock = null;
    } else if (isDeepStrictEqual(history, entry.persistedHistory)) {
      entry.lastAccessAt = Date.now();
      return entry.history;
    } else {
      trackError({
        service: 'conversationCache',
        severity: 'warning',
        error: new Error(
          `Discarded stale dirty cache for "${whatsappId}" because the stored history changed.`,
        ),
        context: { whatsappId, stage: 'dirtyRefreshConflict' },
      });
      entry.dirty = false;
      entry.lock = null;
    }
  }

  entry.history = history;
  entry.persistedHistory = history;
  entry.lastAccessAt = Date.now();
  return entry.history;
}

export function setCachedConversationHistory(
  whatsappId,
  history,
  { lock = null } = {},
) {
  const entry = getOrCreateEntry(whatsappId, history);
  entry.history = history;
  entry.dirty = true;
  entry.lastAccessAt = Date.now();
  entry.lock = lock;

  if (!entry.flushInFlight) {
    drainFlush(whatsappId, entry);
  }

  ensureSweepTimer();
}

async function drainFlush(whatsappId, entry) {
  entry.flushInFlight = true;

  try {
    while (entry.dirty) {
      const historyToPersist = entry.history;
      const lockToPersist = entry.lock;
      entry.dirty = false;

      try {
        if (lockToPersist) {
          await saveConversationHistory(whatsappId, historyToPersist, {
            lock: lockToPersist,
          });
        } else {
          await saveConversationHistory(whatsappId, historyToPersist);
        }
        entry.persistedHistory = historyToPersist;
      } catch (error) {
        entry.dirty = true;
        trackError({
          service: 'conversationCache',
          severity: 'warning',
          error,
          context: { whatsappId, stage: 'flush' },
        });
        break;
      }
    }

    if (!entry.dirty) {
      entry.lock = null;
    }
  } finally {
    entry.flushInFlight = false;
  }
}

export async function flushConversationHistory(whatsappId) {
  const entry = cache.get(whatsappId);
  if (!entry) return;

  if (!entry.flushInFlight && entry.dirty) {
    await drainFlush(whatsappId, entry);
  } else {
    while (entry.flushInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (cache.get(whatsappId)?.dirty) {
    throw new Error(
      `Failed to flush conversation history for "${whatsappId}": last save attempt was unsuccessful.`,
    );
  }
}

async function evictIdleEntries() {
  const now = Date.now();

  for (const [whatsappId, entry] of cache) {
    if (now - entry.lastAccessAt <= idleTtlMs) {
      continue;
    }

    if (entry.dirty || entry.flushInFlight) {
      await flushConversationHistory(whatsappId);
    }

    const current = cache.get(whatsappId);
    if (current && now - current.lastAccessAt > idleTtlMs && !current.dirty) {
      cache.delete(whatsappId);
    }
  }
}

function ensureSweepTimer() {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    evictIdleEntries().catch((error) => {
      trackError({
        service: 'conversationCache',
        severity: 'warning',
        error,
        context: { stage: 'idleSweep' },
      });
    });
  }, DEFAULT_SWEEP_INTERVAL_MS);

  sweepTimer.unref?.();
}

export async function flushAllConversationCache() {
  const results = await Promise.allSettled(
    Array.from(cache.keys()).map((whatsappId) =>
      flushConversationHistory(whatsappId),
    ),
  );

  const failures = results
    .filter((r) => r.status === 'rejected')
    .map((r) => r.reason?.message ?? String(r.reason));

  if (failures.length > 0) {
    throw new Error(
      `flushAllConversationCache: ${failures.length} flush(es) failed:\n${failures.join('\n')}`,
    );
  }
}

export function __configureConversationCacheForTests({
  idleTtlMs: ttl,
} = {}) {
  if (typeof ttl === 'number') {
    idleTtlMs = ttl;
  }
}

export function __resetConversationCacheForTests() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  cache.clear();
  idleTtlMs = DEFAULT_IDLE_TTL_MS;
}
