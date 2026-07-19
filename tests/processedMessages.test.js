import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockFrom, mockInsert } = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockFrom = vi.fn(() => ({ insert: mockInsert }));
  return { mockFrom, mockInsert };
});

vi.mock('../src/config/supabaseClient.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

const ORIGINAL_ENV = { ...process.env };

describe('claimMessage', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    mockFrom.mockClear();
    mockInsert.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns true without touching Supabase when there is no message id', async () => {
    const { claimMessage } = await import(
      '../src/services/processedMessages.js'
    );

    const result = await claimMessage(undefined, '212600000000');

    expect(result).toBe(true);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns true and records the id on first delivery', async () => {
    mockInsert.mockResolvedValue({ error: null });

    const { claimMessage } = await import(
      '../src/services/processedMessages.js'
    );

    const result = await claimMessage('wamid.123', '212600000000');

    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('processed_messages');
    expect(mockInsert).toHaveBeenCalledWith({
      message_id: 'wamid.123',
      whatsapp_id: '212600000000',
    });
  });

  it('returns false on a duplicate delivery (unique violation)', async () => {
    mockInsert.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value' },
    });

    const { claimMessage } = await import(
      '../src/services/processedMessages.js'
    );

    const result = await claimMessage('wamid.123', '212600000000');

    expect(result).toBe(false);
  });

  it('fails open (returns true) when Supabase errors for another reason', async () => {
    mockInsert.mockResolvedValue({
      error: { code: '500', message: 'connection refused' },
    });

    const { claimMessage } = await import(
      '../src/services/processedMessages.js'
    );

    const result = await claimMessage('wamid.123', '212600000000');

    expect(result).toBe(true);
  });
});
