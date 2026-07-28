import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockFrom, mockSelect, mockEq, mockMaybeSingle, mockUpsert, mockRpc } =
  vi.hoisted(() => {
    const mockMaybeSingle = vi.fn();
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    const mockUpsert = vi.fn();
    const mockRpc = vi.fn();
    const mockFrom = vi.fn(() => ({
      select: mockSelect,
      upsert: mockUpsert,
    }));
    return {
      mockFrom,
      mockSelect,
      mockEq,
      mockMaybeSingle,
      mockUpsert,
      mockRpc,
    };
  });
vi.mock('../src/config/supabaseClient.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom, rpc: mockRpc }),
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

    const error = new Error(
      `Supabase operation "${operation}" failed: ${lastError.message}`
    );
    error.cause = lastError;
    throw error;
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
    mockRpc.mockReset();
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
    it('uses the lock-checked database function when a lock is provided', async () => {
      mockRpc.mockResolvedValue({ error: null });
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );
      const history = [{ role: 'user', content: 'Hello' }];
      const lock = {
        key: '9715551234',
        ownerId: 'owner-1',
        assertLockHeld: vi.fn(),
      };

      await saveConversationHistory('9715551234', history, { lock });

      expect(lock.assertLockHeld).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith(
        'save_conversation_history_with_lock',
        {
          p_whatsapp_id: '9715551234',
          p_history: history,
          p_lock_key: '9715551234',
          p_lock_owner_id: 'owner-1',
        }
      );
      expect(mockUpsert).not.toHaveBeenCalled();
    });
    it('marks a rejected lock-checked save as a lost lock', async () => {
      mockRpc.mockResolvedValue({
        error: {
          code: 'P0001',
          message: 'Distributed lock for "9715551234" is no longer held.',
        },
      });
      const { saveConversationHistory } = await import(
        '../src/services/conversationStore.js'
      );

      const save = saveConversationHistory(
        '9715551234',
        [{ role: 'user', content: 'Hello' }],
        {
          lock: {
            key: '9715551234',
            ownerId: 'owner-1',
            assertLockHeld: vi.fn(),
          },
        }
      );

      await expect(save).rejects.toMatchObject({
        code: 'DISTRIBUTED_LOCK_LOST',
      });
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
