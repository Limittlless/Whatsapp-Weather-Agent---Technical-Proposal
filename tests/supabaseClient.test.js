import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  it('throws a clear error when SUPABASE_URL is missing', async () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const { getSupabaseClient } = await import('../src/config/supabaseClient.js');
    expect(() => getSupabaseClient()).toThrow(/Missing Supabase configuration/);
  });
  it('throws a clear error when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getSupabaseClient } = await import('../src/config/supabaseClient.js');
    expect(() => getSupabaseClient()).toThrow(/Missing Supabase configuration/);
  });
  it('creates a client successfully when both env vars are present', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const { getSupabaseClient } = await import('../src/config/supabaseClient.js');
    const client = getSupabaseClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
  it('returns the same cached instance on repeated calls (singleton)', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const { getSupabaseClient } = await import('../src/config/supabaseClient.js');
    const clientA = getSupabaseClient();
    const clientB = getSupabaseClient();
    expect(clientA).toBe(clientB);
  });
});
