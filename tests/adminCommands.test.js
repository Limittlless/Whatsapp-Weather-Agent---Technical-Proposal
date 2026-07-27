import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockVerifySupabaseConnection,
  mockAuthorizeUser,
  mockGetAuthorizedUser,
  mockListAuthorizedUsers,
  mockNormalizeWhatsappId,
  mockRevokeUser,
} = vi.hoisted(() => ({
  mockVerifySupabaseConnection: vi.fn(),
  mockAuthorizeUser: vi.fn(),
  mockGetAuthorizedUser: vi.fn(),
  mockListAuthorizedUsers: vi.fn(),
  mockNormalizeWhatsappId: vi.fn(),
  mockRevokeUser: vi.fn(),
}));

vi.mock('../src/config/supabaseClient.js', () => ({
  verifySupabaseConnection: mockVerifySupabaseConnection,
}));

vi.mock('../src/services/userAuthorization.js', () => ({
  authorizeUser: mockAuthorizeUser,
  getAuthorizedUser: mockGetAuthorizedUser,
  listAuthorizedUsers: mockListAuthorizedUsers,
  normalizeWhatsappId: mockNormalizeWhatsappId,
  revokeUser: mockRevokeUser,
}));

const {
  isAdminCommandMessage,
  executeAdminCommand,
} = await import('../src/services/adminCommands.js');
const { recordGeminiCall, __resetUsageForTests } = await import(
  '../src/services/usageMetrics.js'
);

describe('adminCommands', () => {
  beforeEach(() => {
    __resetUsageForTests();
    mockVerifySupabaseConnection.mockReset();
    mockVerifySupabaseConnection.mockResolvedValue(true);
    mockAuthorizeUser.mockReset();
    mockGetAuthorizedUser.mockReset();
    mockListAuthorizedUsers.mockReset();
    mockNormalizeWhatsappId.mockReset();
    mockRevokeUser.mockReset();
    mockNormalizeWhatsappId.mockImplementation((value) => {
      const normalized = String(value ?? '')
        .trim()
        .replace(/[\s()+-]/g, '');

      if (!/^\d{7,15}$/.test(normalized)) {
        throw new Error('WhatsApp ID must contain 7 to 15 digits.');
      }

      return normalized;
    });
  });

  describe('isAdminCommandMessage', () => {
    it('returns true for a message starting with "/"', () => {
      expect(isAdminCommandMessage('/status')).toBe(true);
      expect(isAdminCommandMessage('/فيش-كوتا')).toBe(true);
    });

    it('returns true even with leading whitespace before the slash', () => {
      expect(isAdminCommandMessage('   /status')).toBe(true);
    });

    it('returns false for an ordinary message', () => {
      expect(isAdminCommandMessage('ما هو الطقس اليوم؟')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isAdminCommandMessage(undefined)).toBe(false);
      expect(isAdminCommandMessage(null)).toBe(false);
      expect(isAdminCommandMessage(123)).toBe(false);
    });
  });

  describe('executeAdminCommand', () => {
    it('handles /status and reports a healthy Supabase connection', async () => {
      mockVerifySupabaseConnection.mockResolvedValue(true);

      const reply = await executeAdminCommand('/status');

      expect(reply).toContain('حالة النظام');
      expect(reply).toContain('✅ متصل');
      expect(mockVerifySupabaseConnection).toHaveBeenCalled();
    });

    it('handles /status and reports a broken Supabase connection', async () => {
      mockVerifySupabaseConnection.mockRejectedValue(
        new Error('connection refused')
      );

      const reply = await executeAdminCommand('/status');

      expect(reply).toContain('غير متصل');
      expect(reply).toContain('connection refused');
    });

    it('includes the last Gemini error in /status when present', async () => {
      recordGeminiCall({ ok: false, error: new Error('rate limited') });

      const reply = await executeAdminCommand('/status');

      expect(reply).toContain('rate limited');
    });

    it('handles the Arabic alias حالة for /status', async () => {
      const reply = await executeAdminCommand('/حالة');

      expect(reply).toContain('حالة النظام');
    });

    it('handles /uptime', async () => {
      const reply = await executeAdminCommand('/uptime');

      expect(reply).toContain('مدة تشغيل الخادم');
    });

    it('handles the Arabic alias توفر for /uptime', async () => {
      const reply = await executeAdminCommand('/توفر');

      expect(reply).toContain('مدة تشغيل الخادم');
    });

    it('handles /quota with tracked usage numbers', async () => {
      recordGeminiCall({ ok: true });
      recordGeminiCall({ ok: true });
      recordGeminiCall({ ok: false, error: new Error('boom') });

      const reply = await executeAdminCommand('/quota');

      expect(reply).toContain('استخدام Gemini API');
      expect(reply).toContain('إجمالي الاستدعاءات: 3');
      expect(reply).toContain('ناجحة: 2');
      expect(reply).toContain('فاشلة: 1');

      expect(reply).toMatch(/لا يوفّر رقمًا رسميًا/);
    });

    it('handles the Arabic alias فيش-كوتا for /quota', async () => {
      const reply = await executeAdminCommand('/فيش-كوتا');

      expect(reply).toContain('استخدام Gemini API');
    });

    it('shows configured RPM/RPD limits in /quota when set', async () => {
      process.env.GEMINI_RPM_LIMIT = '60';
      process.env.GEMINI_RPD_LIMIT = '1000';

      const reply = await executeAdminCommand('/quota');

      expect(reply).toContain('/ 60 (الحد المُعرّف)');
      expect(reply).toContain('/ 1000 (الحد المُعرّف)');

      delete process.env.GEMINI_RPM_LIMIT;
      delete process.env.GEMINI_RPD_LIMIT;
    });

    it('handles /help', async () => {
      const reply = await executeAdminCommand('/help');

      expect(reply).toContain('أوامر المسؤول المتاحة');
      expect(reply).toContain('/status');
      expect(reply).toContain('/quota');
      expect(reply).toContain('/auth');
    });

    it('shows usage instructions for /auth', async () => {
      const reply = await executeAdminCommand('/auth', {
        adminWhatsappId: '212600000000',
      });

      expect(reply).toContain('/auth add');
      expect(reply).toContain('/auth remove');
      expect(reply).toContain('/auth status');
      expect(reply).toContain('/auth list');
    });

    it('authorizes a user with /auth add', async () => {
      mockAuthorizeUser.mockResolvedValue({
        whatsapp_id: '212611111111',
        display_name: 'Ahmed Ben Ali',
      });

      const reply = await executeAdminCommand(
        '/auth add +212611-111-111 Ahmed Ben Ali',
        { adminWhatsappId: '212600000000' }
      );

      expect(mockAuthorizeUser).toHaveBeenCalledWith({
        whatsappId: '212611111111',
        displayName: 'Ahmed Ben Ali',
        authorizedBy: '212600000000',
      });
      expect(reply).toContain('Authorized 212611111111');
      expect(reply).toContain('Ahmed Ben Ali');
    });

    it('revokes a user with /auth remove', async () => {
      mockRevokeUser.mockResolvedValue(true);

      const reply = await executeAdminCommand(
        '/auth remove 212611111111',
        { adminWhatsappId: '212600000000' }
      );

      expect(mockRevokeUser).toHaveBeenCalledWith({
        whatsappId: '212611111111',
        revokedBy: '212600000000',
      });
      expect(reply).toContain('Revoked access');
    });

    it('reports when /auth remove targets an inactive user', async () => {
      mockRevokeUser.mockResolvedValue(false);

      const reply = await executeAdminCommand(
        '/auth remove 212611111111',
        { adminWhatsappId: '212600000000' }
      );

      expect(reply).toContain('not currently authorized');
    });

    it('reports an active user with /auth status', async () => {
      mockGetAuthorizedUser.mockResolvedValue({
        whatsapp_id: '212611111111',
        display_name: 'Ahmed',
        active: true,
        authorized_by: '212600000000',
        authorized_at: '2026-07-27T19:00:00.000Z',
      });

      const reply = await executeAdminCommand(
        '/auth status 212611111111',
        { adminWhatsappId: '212600000000' }
      );

      expect(mockGetAuthorizedUser).toHaveBeenCalledWith('212611111111');
      expect(reply).toContain('is authorized');
      expect(reply).toContain('Name: Ahmed');
      expect(reply).toContain('Authorized by: 212600000000');
    });

    it('reports an unknown user with /auth status', async () => {
      mockGetAuthorizedUser.mockResolvedValue(null);

      const reply = await executeAdminCommand(
        '/auth status 212611111111',
        { adminWhatsappId: '212600000000' }
      );

      expect(reply).toContain('is not authorized');
    });

    it('lists active users with /auth list', async () => {
      mockListAuthorizedUsers.mockResolvedValue([
        {
          whatsapp_id: '212611111111',
          display_name: 'Ahmed',
        },
        {
          whatsapp_id: '212622222222',
          display_name: null,
        },
      ]);

      const reply = await executeAdminCommand('/auth list', {
        adminWhatsappId: '212600000000',
      });

      expect(reply).toContain('Authorized users (2, showing up to 30)');
      expect(reply).toContain('212611111111 — Ahmed');
      expect(reply).toContain('212622222222');
    });

    it('rejects an invalid WhatsApp ID without calling Supabase', async () => {
      const reply = await executeAdminCommand('/auth add invalid-number', {
        adminWhatsappId: '212600000000',
      });

      expect(reply).toContain('WhatsApp ID must contain');
      expect(mockAuthorizeUser).not.toHaveBeenCalled();
    });

    it('requires admin context for /auth commands', async () => {
      await expect(executeAdminCommand('/auth list')).rejects.toThrow(
        'adminWhatsappId is required'
      );
    });

    it('returns auth help for an unknown auth action', async () => {
      const reply = await executeAdminCommand('/auth something', {
        adminWhatsappId: '212600000000',
      });

      expect(reply).toContain('Unknown auth action');
      expect(reply).toContain('/auth add');
      expect(mockAuthorizeUser).not.toHaveBeenCalled();
    });

    it('returns a helpful message for an unknown command', async () => {
      const reply = await executeAdminCommand('/nonsense');

      expect(reply).toContain('أمر غير معروف');
      expect(reply).toContain('nonsense');
      expect(reply).toContain('أوامر المسؤول المتاحة');
    });

    it('is case-insensitive for English command names', async () => {
      const reply = await executeAdminCommand('/STATUS');

      expect(reply).toContain('حالة النظام');
    });
  });
});
