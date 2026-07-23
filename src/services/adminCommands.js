import { verifySupabaseConnection } from '../config/supabaseClient.js';
import { getUsageSnapshot } from './usageMetrics.js';

const COMMAND_PREFIX = '/';

const COMMAND_ALIASES = {
  status: ['status', 'حالة', 'الحالة'],
  uptime: ['uptime', 'توفر', 'مدة-التشغيل', 'مدة_التشغيل'],
  quota: ['quota', 'فيش-كوتا', 'فيش_كوتا', 'فيشكوتا', 'كوتا'],
  help: ['help', 'مساعدة', 'اوامر', 'أوامر'],
};

function resolveCommandName(rawCommand) {
  const normalized = rawCommand.trim().toLowerCase();

  for (const [canonical, aliases] of Object.entries(COMMAND_ALIASES)) {
    if (aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return canonical;
    }
  }

  return null;
}

export function isAdminCommandMessage(text) {
  return typeof text === 'string' && text.trim().startsWith(COMMAND_PREFIX);
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}ي`);
  if (hours > 0) parts.push(`${hours}س`);
  if (minutes > 0) parts.push(`${minutes}د`);
  parts.push(`${seconds}ث`);

  return parts.join(' ');
}

function formatTimeAgo(timestampMs) {
  if (!timestampMs) return 'لا يوجد';
  const secondsAgo = Math.floor((Date.now() - timestampMs) / 1000);
  if (secondsAgo < 60) return `منذ ${secondsAgo} ثانية`;
  if (secondsAgo < 3600) return `منذ ${Math.floor(secondsAgo / 60)} دقيقة`;
  return `منذ ${Math.floor(secondsAgo / 3600)} ساعة`;
}

async function handleStatus() {
  const startedAt = Date.now();
  let supabaseStatus = '✅ متصل';

  try {
    await verifySupabaseConnection();
  } catch (error) {
    supabaseStatus = `❌ غير متصل (${error.message})`;
  }

  const supabaseLatencyMs = Date.now() - startedAt;
  const usage = getUsageSnapshot();

  const lines = [
    '📊 *حالة النظام*',
    '',
    `🟢 الخادم: يعمل`,
    `⏱️ مدة التشغيل: ${formatDuration(usage.uptimeMs)}`,
    `🗄️ Supabase: ${supabaseStatus} (${supabaseLatencyMs}ms)`,
    `🤖 آخر استدعاء لـ Gemini: ${formatTimeAgo(usage.lastGeminiCallAt)}`,
    `📈 طلبات Gemini (24 ساعة): ${usage.callsLast24h}`,
  ];

  if (usage.lastGeminiError) {
    lines.push(
      `⚠️ آخر خطأ في Gemini (${formatTimeAgo(
        usage.lastGeminiError.at
      )}): ${usage.lastGeminiError.message}`
    );
  }

  return lines.join('\n');
}

function handleUptime() {
  const usage = getUsageSnapshot();
  return `⏱️ مدة تشغيل الخادم: ${formatDuration(usage.uptimeMs)}`;
}

function handleQuota() {
  const usage = getUsageSnapshot();

  const lines = [
    '🔢 *استخدام Gemini API*',
    '',
    'ملاحظة: Gemini لا يوفّر رقمًا رسميًا للحصة المتبقية عبر الـ API — ' +
      'هذا عدّاد داخلي لما استدعاه هذا الخادم فقط (يُعاد ضبطه عند إعادة التشغيل).',
    '',
    `📞 إجمالي الاستدعاءات: ${usage.geminiCallsTotal}`,
    `✅ ناجحة: ${usage.geminiCallsOk}`,
    `❌ فاشلة: ${usage.geminiCallsFailed}`,
    `📅 آخر 24 ساعة: ${usage.callsLast24h}` +
      (usage.rpdLimit ? ` / ${usage.rpdLimit} (الحد المُعرّف)` : ''),
    `⏳ آخر دقيقة: ${usage.callsLastMinute}` +
      (usage.rpmLimit ? ` / ${usage.rpmLimit} (الحد المُعرّف)` : ''),
  ];

  if (!usage.rpmLimit && !usage.rpdLimit) {
    lines.push(
      '',
      'لعرض نسبة الاستهلاك من حدك الفعلي، عرّف GEMINI_RPM_LIMIT و/أو ' +
        'GEMINI_RPD_LIMIT في متغيرات البيئة حسب باقتك في Google AI Studio.'
    );
  }

  return lines.join('\n');
}

function handleHelp() {
  return [
    '🛠️ *أوامر المسؤول المتاحة*',
    '',
    '/status — حالة النظام العامة (تشغيل، Supabase، آخر نشاط)',
    '/uptime — مدة تشغيل الخادم منذ آخر إعادة تشغيل',
    '/quota — إحصائيات استخدام Gemini المتتبَّعة داخليًا',
    '/help — عرض هذه القائمة',
  ].join('\n');
}

export async function executeAdminCommand(text) {
  const withoutPrefix = text.trim().slice(COMMAND_PREFIX.length);
  const [firstToken] = withoutPrefix.split(/\s+/);
  const commandName = resolveCommandName(firstToken ?? '');

  switch (commandName) {
    case 'status':
      return handleStatus();
    case 'uptime':
      return handleUptime();
    case 'quota':
      return handleQuota();
    case 'help':
      return handleHelp();
    default:
      return (
        `❓ أمر غير معروف: "${firstToken}"\n\n` + handleHelp()
      );
  }
}
