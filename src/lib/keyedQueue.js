import { getSupabaseClient } from '../config/supabaseClient.js';
import { measureLatency } from './latency.js';

const tails = new Map();

const DEFAULT_LOCK_TTL_MS = 30_000;
const DEFAULT_LOCK_WAIT_TIMEOUT_MS = 25_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 100;
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 10_000;

let clientOverride;
let lockTtlMs = DEFAULT_LOCK_TTL_MS;
let lockWaitTimeoutMs = DEFAULT_LOCK_WAIT_TIMEOUT_MS;
let lockPollIntervalMs = DEFAULT_LOCK_POLL_INTERVAL_MS;
let lockRenewIntervalMs = DEFAULT_LOCK_RENEW_INTERVAL_MS;

const unlockedContext = Object.freeze({
  key: null,
  ownerId: null,
  signal: undefined,
  assertLockHeld() {},
});

export function runExclusive(key, task, { traceId } = {}) {
  const previousTail = tails.get(key) ?? Promise.resolve();

  const current = previousTail.then(
    () => executeWithDistributedLock(key, task, traceId),
    () => executeWithDistributedLock(key, task, traceId),
  );

  const tailForChaining = current.then(
    () => undefined,
    () => undefined,
  );

  tails.set(key, tailForChaining);

  tailForChaining.finally(() => {
    if (tails.get(key) === tailForChaining) {
      tails.delete(key);
    }
  });

  return current;
}

async function executeWithDistributedLock(key, task, traceId) {
  let supabase;

  if (clientOverride !== undefined) {
    supabase = clientOverride;
  } else {
    try {
      supabase = getSupabaseClient();
    } catch {
      supabase = null;
    }
  }

  if (!supabase) return task(unlockedContext);

  const ownerId = await measureLatency(
    traceId,
    'lock.acquire',
    () =>
      acquireDistributedLock(key, supabase).catch((error) => {
        console.error(
          `[keyedQueue] Failed to acquire distributed lock for "${key}":`,
          error instanceof Error ? error.message : error,
        );
        throw error;
      }),
  );

  const lease = startLockRenewal(key, ownerId, supabase);
  const taskPromise = Promise.resolve().then(() => task(lease.context));

  try {
    return await Promise.race([taskPromise, lease.lost]);
  } finally {
    try {
      await lease.stop();
    } finally {
      await measureLatency(
        traceId,
        'lock.release',
        () => releaseDistributedLock(key, ownerId, supabase),
      );
    }
  }
}

async function acquireDistributedLock(key, supabase) {
  if (!supabase) return null;

  const ownerId = `${process.pid}_${Math.random().toString(36).slice(2, 9)}`;
  const startTime = Date.now();

  while (Date.now() - startTime < lockWaitTimeoutMs) {
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + lockTtlMs).toISOString();

    try {
      await supabase
        .from('distributed_locks')
        .delete()
        .eq('lock_key', key)
        .lt('expires_at', nowIso);
    } catch {
      // ignore cleanup errors
    }

    const { error } = await supabase.from('distributed_locks').insert({
      lock_key: key,
      owner_id: ownerId,
      expires_at: expiresAtIso,
    });

    if (!error) {
      return ownerId;
    }

    if (error.code === '23505') {
      await new Promise((resolve) => {
        setTimeout(resolve, lockPollIntervalMs);
      });
      continue;
    }

    throw error;
  }

  const timeoutError = new Error(
    `Timeout waiting for distributed lock on key "${key}" after ${lockWaitTimeoutMs}ms`,
  );
  timeoutError.code = 'DISTRIBUTED_LOCK_TIMEOUT';
  throw timeoutError;
}

function startLockRenewal(key, ownerId, supabase) {
  let stopped = false;
  let timer = null;
  let renewalInFlight = Promise.resolve();
  let lockError = null;
  let rejectLost;
  const abortController = new AbortController();
  const lost = new Promise((_, reject) => {
    rejectLost = reject;
  });

  const markLockLost = (error) => {
    if (lockError) return;

    lockError = error;
    stopped = true;
    abortController.abort(error);
    rejectLost(error);
  };

  const scheduleRenewal = (delayMs = lockRenewIntervalMs) => {
    timer = setTimeout(() => {
      renewalInFlight = renewDistributedLock(key, ownerId, supabase)
        .catch((error) => {
          console.error(
            `[keyedQueue] Failed to renew lock for "${key}":`,
            error instanceof Error ? error.message : error,
          );
          markLockLost(error);
          throw error;
        })
        .finally(() => {
          if (!stopped) {
            scheduleRenewal();
          }
        });
    }, delayMs);
    timer.unref?.();
  };

  scheduleRenewal();

  return {
    context: Object.freeze({
      key,
      ownerId,
      signal: abortController.signal,
      assertLockHeld() {
        if (lockError) throw lockError;
      },
    }),
    lost,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await renewalInFlight;
    },
  };
}

async function renewDistributedLock(key, ownerId, supabase) {
  const expiresAtIso = new Date(Date.now() + lockTtlMs).toISOString();
  const { data, error } = await supabase
    .from('distributed_locks')
    .update({ expires_at: expiresAtIso })
    .eq('lock_key', key)
    .eq('owner_id', ownerId)
    .select('lock_key')
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const lostLockError = new Error(
      `Distributed lock for "${key}" is no longer owned by this process.`,
    );
    lostLockError.code = 'DISTRIBUTED_LOCK_LOST';
    throw lostLockError;
  }
}

async function releaseDistributedLock(key, ownerId, supabase) {
  try {
    if (!supabase) return;

    const { error } = await supabase
      .from('distributed_locks')
      .delete()
      .eq('lock_key', key)
      .eq('owner_id', ownerId);

    if (error) throw error;
  } catch (error) {
    console.warn(
      `[keyedQueue] Failed to release lock for "${key}":`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function drainKeyedQueue() {
  await Promise.allSettled(Array.from(tails.values()));
}

export function __configureKeyedQueueForTests({
  supabaseClient,
  ttlMs,
  waitTimeoutMs,
  pollIntervalMs,
  renewIntervalMs,
} = {}) {
  if (supabaseClient !== undefined) clientOverride = supabaseClient;
  if (typeof ttlMs === 'number') lockTtlMs = ttlMs;
  if (typeof waitTimeoutMs === 'number') {
    lockWaitTimeoutMs = waitTimeoutMs;
  }
  if (typeof pollIntervalMs === 'number') {
    lockPollIntervalMs = pollIntervalMs;
  }
  if (typeof renewIntervalMs === 'number') {
    lockRenewIntervalMs = renewIntervalMs;
  }
}

export function __resetKeyedQueueForTests() {
  tails.clear();
  clientOverride = undefined;
  lockTtlMs = DEFAULT_LOCK_TTL_MS;
  lockWaitTimeoutMs = DEFAULT_LOCK_WAIT_TIMEOUT_MS;
  lockPollIntervalMs = DEFAULT_LOCK_POLL_INTERVAL_MS;
  lockRenewIntervalMs = DEFAULT_LOCK_RENEW_INTERVAL_MS;
}
