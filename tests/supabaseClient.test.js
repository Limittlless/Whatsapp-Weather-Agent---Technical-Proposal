import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('dotenv/config', () => ({}));

const { mockFrom, mockSelect } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn(() => ({ select: mockSelect }));
  return { mockFrom, mockSelect };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const ORIGINAL_ENV = { ...process.env };

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    mockFrom.mockClear();
    mockSelect.mockReset();
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
describe('verifySupabaseConnection', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockFrom.mockClear();
    mockSelect.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  it('resolves true when the query succeeds with no error', async () => {
    mockSelect.mockResolvedValue({ error: null });
    const { verifySupabaseConnection } = await import('../src/config/supabaseClient.js');
    await expect(verifySupabaseConnection()).resolves.toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('conversations');
    expect(mockSelect).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });
  it('throws when the conversations table does not exist (PGRST205)', async () => {
    mockSelect.mockResolvedValue({
      error: { code: 'PGRST205', message: 'relation "conversations" does not exist' },
    });
    const { verifySupabaseConnection } = await import('../src/config/supabaseClient.js');
    await expect(verifySupabaseConnection()).rejects.toThrow(
      /Supabase connection check failed/
    );
  });
  it('throws with the underlying message on an auth/connection error', async () => {
    mockSelect.mockResolvedValue({
      error: { code: '401', message: 'Invalid API key' },
    });
    const { verifySupabaseConnection } = await import('../src/config/supabaseClient.js');
    await expect(verifySupabaseConnection()).rejects.toThrow(/Invalid API key/);
  });
});