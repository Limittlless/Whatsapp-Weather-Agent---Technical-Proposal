import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  query,
  mockFrom,
  mockSelect,
  mockEq,
  mockMaybeSingle,
  mockUpsert,
  mockUpdate,
  mockOrder,
  mockLimit,
} = vi.hoisted(() => {
  const query = {};
  const mockFrom = vi.fn(() => query);
  const mockSelect = vi.fn(() => query);
  const mockEq = vi.fn(() => query);
  const mockMaybeSingle = vi.fn();
  const mockUpsert = vi.fn();
  const mockUpdate = vi.fn(() => query);
  const mockOrder = vi.fn(() => query);
  const mockLimit = vi.fn();

  Object.assign(query, {
    select: mockSelect,
    eq: mockEq,
    maybeSingle: mockMaybeSingle,
    upsert: mockUpsert,
    update: mockUpdate,
    order: mockOrder,
    limit: mockLimit,
  });

  return {
    query,
    mockFrom,
    mockSelect,
    mockEq,
    mockMaybeSingle,
    mockUpsert,
    mockUpdate,
    mockOrder,
    mockLimit,
  };
});

vi.mock('../src/config/supabaseClient.js', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
  withSupabaseRetry: async (queryFn, { operation } = {}) => {
    const result = await queryFn();

    if (result?.error) {
      throw new Error(
        `Supabase operation "${operation}" failed: ${result.error.message}`
      );
    }

    return result;
  },
}));

const {
  authorizeUser,
  getAuthorizedUser,
  isUserAuthorized,
  listAuthorizedUsers,
  normalizeWhatsappId,
  revokeUser,
} = await import('../src/services/userAuthorization.js');

const validUser = {
  whatsapp_id: '212611111111',
  display_name: 'Ahmed',
  active: true,
  authorized_by: '212600000000',
  authorized_at: '2026-07-27T19:00:00.000Z',
  revoked_by: null,
  revoked_at: null,
};

describe('userAuthorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue(query);
    mockEq.mockReturnValue(query);
    mockUpdate.mockReturnValue(query);
    mockOrder.mockReturnValue(query);
  });

  describe('normalizeWhatsappId', () => {
    it('normalizes common E.164 formatting characters', () => {
      expect(normalizeWhatsappId('+212 611-111-111')).toBe('212611111111');
      expect(normalizeWhatsappId('(212) 611 111 111')).toBe('212611111111');
    });

    it('rejects missing, alphabetic, short, and oversized IDs', () => {
      expect(() => normalizeWhatsappId('')).toThrow('7 to 15 digits');
      expect(() => normalizeWhatsappId('212ABC')).toThrow('7 to 15 digits');
      expect(() => normalizeWhatsappId('123456')).toThrow('7 to 15 digits');
      expect(() => normalizeWhatsappId('1'.repeat(16))).toThrow(
        '7 to 15 digits'
      );
    });
  });

  describe('getAuthorizedUser / isUserAuthorized', () => {
    it('returns null when the user has no authorization row', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      await expect(getAuthorizedUser('212611111111')).resolves.toBeNull();
      expect(mockFrom).toHaveBeenCalledWith('authorized_users');
      expect(mockEq).toHaveBeenCalledWith(
        'whatsapp_id',
        '212611111111'
      );
    });

    it('returns a validated authorization row', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: validUser,
        error: null,
      });

      await expect(
        getAuthorizedUser('+212611111111')
      ).resolves.toEqual(validUser);
    });

    it('rejects a malformed authorization row', async () => {
      mockMaybeSingle.mockResolvedValue({
        data: { ...validUser, active: 'yes' },
        error: null,
      });

      await expect(getAuthorizedUser('212611111111')).rejects.toThrow(
        'malformed authorized-user'
      );
    });

    it('returns true only for an active authorization row', async () => {
      mockMaybeSingle
        .mockResolvedValueOnce({ data: validUser, error: null })
        .mockResolvedValueOnce({
          data: { ...validUser, active: false },
          error: null,
        })
        .mockResolvedValueOnce({ data: null, error: null });

      await expect(isUserAuthorized('212611111111')).resolves.toBe(true);
      await expect(isUserAuthorized('212611111111')).resolves.toBe(false);
      await expect(isUserAuthorized('212611111111')).resolves.toBe(false);
    });
  });

  describe('authorizeUser', () => {
    it('upserts a normalized, active authorization record', async () => {
      mockUpsert.mockResolvedValue({ error: null });

      const result = await authorizeUser({
        whatsappId: '+212611-111-111',
        displayName: '  Ahmed  ',
        authorizedBy: '212600000000',
      });

      expect(mockFrom).toHaveBeenCalledWith('authorized_users');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          whatsapp_id: '212611111111',
          display_name: 'Ahmed',
          active: true,
          authorized_by: '212600000000',
          authorized_at: expect.any(String),
          revoked_by: null,
          revoked_at: null,
        }),
        { onConflict: 'whatsapp_id' }
      );
      expect(result).toEqual(
        expect.objectContaining({
          whatsapp_id: '212611111111',
          display_name: 'Ahmed',
          active: true,
        })
      );
    });

    it('rejects an oversized display name before querying Supabase', async () => {
      await expect(
        authorizeUser({
          whatsappId: '212611111111',
          displayName: 'a'.repeat(81),
          authorizedBy: '212600000000',
        })
      ).rejects.toThrow('80 characters');

      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('clears a stale display name when no name is supplied', async () => {
      mockUpsert.mockResolvedValue({ error: null });

      await authorizeUser({
        whatsappId: '212611111111',
        authorizedBy: '212600000000',
      });

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ display_name: null }),
        { onConflict: 'whatsapp_id' }
      );
    });
  });

  describe('revokeUser', () => {
    it('revokes an active row and records the responsible admin', async () => {
      mockEq
        .mockReturnValueOnce(query)
        .mockResolvedValueOnce({ count: 1, error: null });

      await expect(
        revokeUser({
          whatsappId: '212611111111',
          revokedBy: '212600000000',
        })
      ).resolves.toBe(true);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          active: false,
          revoked_by: '212600000000',
          revoked_at: expect.any(String),
        }),
        { count: 'exact' }
      );
      expect(mockEq).toHaveBeenNthCalledWith(
        1,
        'whatsapp_id',
        '212611111111'
      );
      expect(mockEq).toHaveBeenNthCalledWith(2, 'active', true);
    });

    it('returns false when no active row was updated', async () => {
      mockEq
        .mockReturnValueOnce(query)
        .mockResolvedValueOnce({ count: 0, error: null });

      await expect(
        revokeUser({
          whatsappId: '212611111111',
          revokedBy: '212600000000',
        })
      ).resolves.toBe(false);
    });
  });

  describe('listAuthorizedUsers', () => {
    it('lists validated active users newest first with a bounded limit', async () => {
      mockLimit.mockResolvedValue({
        data: [validUser],
        error: null,
      });

      await expect(
        listAuthorizedUsers({ limit: 500 })
      ).resolves.toEqual([validUser]);

      expect(mockEq).toHaveBeenCalledWith('active', true);
      expect(mockOrder).toHaveBeenCalledWith('authorized_at', {
        ascending: false,
      });
      expect(mockLimit).toHaveBeenCalledWith(30);
    });
  });
});
