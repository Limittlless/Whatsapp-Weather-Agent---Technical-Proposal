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

async function executeWithDistributedLock(key, task) {
  let ownerId = null;

  try {
    ownerId = await acquireDistributedLock(key);
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(
        `[keyedQueue] Distributed lock fallback for "${key}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  try {
    return await task();
  } finally {
    if (ownerId) {
      await releaseDistributedLock(key, ownerId).catch(() => {});
    }
  }
}

async function acquireDistributedLock(key, ttlMs = 30000, timeoutMs = 25000) {
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch {
    return null;
  }
  if (!supabase) return null;

  const ownerId = `${process.pid}_${Math.random().toString(36).slice(2, 9)}`;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + ttlMs).toISOString();

    await supabase
      .from('distributed_locks')
      .delete()
      .eq('lock_key', key)
      .lt('expires_at', nowIso)
      .catch(() => {});

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

  throw new Error(`Timeout waiting for distributed lock on key "${key}"`);
}

async function releaseDistributedLock(key, ownerId) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    await supabase
      .from('distributed_locks')
      .delete()
      .eq('lock_key', key)
      .eq('owner_id', ownerId);
  } catch {
  }
}

export async function drainKeyedQueue() {
  await Promise.allSettled(Array.from(tails.values()));
}

export function __resetKeyedQueueForTests() {
  tails.clear();
}
