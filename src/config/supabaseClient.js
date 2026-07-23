import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

import { withRetry, defaultIsRetryable } from '../lib/retry.js';
import { trackError } from '../services/errorTracker.js';

function createSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase configuration. Please set SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in your .env file (see .env.example).'
    );
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let cachedClient = null;
export function getSupabaseClient() {
  if (!cachedClient) {
    cachedClient = createSupabaseClient();
  }
  return cachedClient;
}

const RETRYABLE_POSTGRES_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '40001',
  '40P01',
  '57014',
]);

function isSupabaseErrorRetryable(error) {
  const pgCode = error?.cause?.code;
  if (typeof pgCode === 'string' && RETRYABLE_POSTGRES_CODES.has(pgCode)) {
    return true;
  }

  return defaultIsRetryable(error);
}

export async function withSupabaseRetry(queryFn, { operation, context } = {}) {
  let attemptsMade = 0;

  async function attempt() {
    attemptsMade += 1;
    const result = await queryFn();

    if (result?.error) {
      const wrapped = new Error(
        `Supabase operation "${operation}" failed: ${result.error.message}`,
      );
      wrapped.cause = result.error;
      throw wrapped;
    }

    return result;
  }

  try {
    return await withRetry(attempt, {
      isRetryable: isSupabaseErrorRetryable,
      onRetry: ({ error, willRetry }) => {
        if (willRetry) {
          console.warn(
            `[supabaseClient] "${operation}" attempt ${attemptsMade} failed, retrying:`,
            error instanceof Error ? error.message : error,
          );
        }
      },
    });
  } catch (error) {
    trackError({
      service: 'supabase',
      severity: 'critical',
      error,
      retryCount: attemptsMade - 1,
      context: { operation, ...context },
    });
    throw error;
  }
}

export async function verifySupabaseConnection() {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('conversations')
    .select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Supabase connection check failed: ${error.message}`);
  }
  return true;
}

export function __resetClientForTests() {
  cachedClient = null;
}
