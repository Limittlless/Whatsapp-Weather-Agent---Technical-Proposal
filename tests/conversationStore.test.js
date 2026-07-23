import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockFrom, mockSelect, mockEq, mockMaybeSingle, mockUpsert } =
  vi.hoisted(() => {
    const mockMaybeSingle = vi.fn();
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockUpsert = vi.fn();
    const mockFrom = vi.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert,
    }));
    return { mockFrom, mockSelect, mockEq, mockMaybeSingle, mockUpsert };
  });
vi.mock('../src/config/supabaseClient.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
  withSupabaseRetry: async (queryFn, { operation } = {}) => {
    let lastError;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await queryFn();
      if (!result?.error) {
        return result;
      }

      lastError = result.error;
      if (result.error.code !== '40P01') {
        break;
      }
    }

    throw new Error(
      `Supabase operation "${operation}" failed: ${lastError.message}`
    );
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe('conversationStore', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq.mockClear();
    mockMaybeSingle.mockReset();
    mockUpsert.mockReset();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  describe('getConversationHistory', () => {
    it('throws when whatsappId is missing', async () => {
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(getConversationHistory('   ')).rejects.toThrow(
        'whatsappId is required'
      );
    });
    it('returns an empty array for a user with no existing row', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      const result = await getConversationHistory('9715551234');
      expect(result).toEqual([]);
      expect(mockFrom).toHaveBeenCalledWith('conversations');
      expect(mockEq).toHaveBeenCalledWith('whatsapp_id', '9715551234');
    });
    it('returns the validated history for an existing user', async () => {
      const storedHistory = [
        { role: 'user', content: 'What is the weather in Cairo?' },
        { role: 'assistant', content: 'It is 32°C and sunny in Cairo.' },
      ];
      mockMaybeSingle.mockResolvedValue({
        data: { history: storedHistory },
        error: null,
      });
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      const result = await getConversationHistory('9715551234');
      expect(result).toEqual(storedHistory);
    });
    it('throws when Supabase returns an error', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      });
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(getConversationHistory('9715551234')).rejects.toThrow(
        'Supabase operation "getConversationHistory" failed: connection refused'
      );
    });
    it('throws when the stored history fails schema validation', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: { history: [{ role: 'not-a-real-role', content: 'hi' }] },
        error: null,
      });
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(getConversationHistory('9715551234')).rejects.toThrow(
        'malformed'
      );
    });
    it('retries a transient (deadlock) read failure and succeeds', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({
          data: null,
          error: { code: '40P01', message: 'deadlock detected' },
        })
        .mockResolvedValueOnce({
          data: { history: [{ role: 'user', content: 'hi' }] },
          error: null,
        });
      const { getConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      const result = await getConversationHistory('9715551234');
      expect(result).toEqual([{ role: 'user', content: 'hi' }]);
      expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
    });
  });
  describe('saveConversationHistory', () => {
    it('throws when whatsappId is missing', async () => {
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(saveConversationHistory('', [])).rejects.toThrow(
        'whatsappId is required'
      );
    });
    it('throws when history is not a valid array of messages', async () => {
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(
        saveConversationHistory('9715551234', 'not-an-array')
      ).rejects.toThrow('malformed');
    });
    it('upserts the validated history keyed by whatsapp_id', async () => {
      mockUpsert.mockResolvedValue({ error: null });
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      const history = [{ role: 'user', content: 'Hello' }];
      await saveConversationHistory('9715551234', history);
      expect(mockFrom).toHaveBeenCalledWith('conversations');
      expect(mockUpsert).toHaveBeenCalledWith(
        { whatsapp_id: '9715551234', history },
        { onConflict: 'whatsapp_id' }
      );
    });
    it('throws when Supabase returns an error on write', async () => {
      mockUpsert.mockResolvedValue({
        error: { message: 'row too large' },
      });
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      await expect(
        saveConversationHistory('9715551234', [
          { role: 'user', content: 'Hello' },
        ])
      ).rejects.toThrow(
        'Supabase operation "saveConversationHistory" failed: row too large'
      );
    });
  });
});
