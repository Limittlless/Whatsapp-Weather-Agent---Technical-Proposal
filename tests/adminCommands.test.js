import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerifySupabaseConnection } = vi.hoisted(() => ({
  mockVerifySupabaseConnection: vi.fn(),
}));

vi.mock('../src/config/supabaseClient.js', () => ({
  verifySupabaseConnection: mockVerifySupabaseConnection,
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
