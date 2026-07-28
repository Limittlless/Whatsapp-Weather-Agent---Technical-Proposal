import { getSupabaseClient } from '../config/supabaseClient.js';

const tails = new Map();

export function runExclusive(key, task) {
  const previousTail = tails.get(key) ?? Promise.resolve();

  const current = previousTail.then(
    () => executeWithDistributedLock(key, task),
    () => executeWithDistributedLock(key, task),
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

function executeWithDistributedLock(key, task) {
  if (process.env.NODE_ENV === 'test') {
    return task();
  }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    supabase = null;
  }

  if (!supabase) {
    return task();
  }

  return (async () => {
    const ownerId = await acquireDistributedLock(key, supabase).catch(
      (error) => {
        console.error(
          `[keyedQueue] Failed to acquire distributed lock for "${key}":`,
          error instanceof Error ? error.message : error,
        );
        throw error;
      },
    );

    try {
      return await task();
    } finally {
      if (ownerId) {
        await releaseDistributedLock(key, ownerId, supabase);
      }
    }
  })();
}

async function acquireDistributedLock(key, supabase, ttlMs = 30000, timeoutMs = 25000) {
  if (!supabase) return null;

  const ownerId = `${process.pid}_${Math.random().toString(36).slice(2, 9)}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + ttlMs).toISOString();

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
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    throw error;
  }

  throw new Error(
    `Timeout waiting for distributed lock on key "${key}" after ${timeoutMs}ms`,
  );
}

async function releaseDistributedLock(key, ownerId, supabase) {
  try {
    if (!supabase) return;

    await supabase
      .from('distributed_locks')
      .delete()
      .eq('lock_key', key)
      .eq('owner_id', ownerId);
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

export function __resetKeyedQueueForTests() {
  tails.clear();
}
