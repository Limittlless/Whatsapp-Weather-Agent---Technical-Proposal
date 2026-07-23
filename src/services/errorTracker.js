const MAX_STORED_ERRORS = 50;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_ADMIN_NUMBER_ENV = 'ADMIN_ALERT_WHATSAPP_NUMBER';

const SEVERITIES = new Set(['info', 'warning', 'critical']);

const state = {
  errors: [],
  sendAlertFn: null,
  adminNumber: null,
  lastAlertBySignature: new Map(),
};

export function configureErrorTracker({ sendAlertFn, adminNumber } = {}) {
  state.sendAlertFn = sendAlertFn ?? null;
  state.adminNumber =
    adminNumber?.trim() || process.env[DEFAULT_ADMIN_NUMBER_ENV]?.trim() || null;
}

function buildSignature({ service, message }) {
  return `${service}::${message}`;
}

function shouldAlert(signature) {
  const last = state.lastAlertBySignature.get(signature);
  if (!last) {
    return true;
  }
  return Date.now() - last > ALERT_COOLDOWN_MS;
}

async function sendCriticalAlert(entry) {
  if (!state.sendAlertFn || !state.adminNumber) {
    console.warn(
      '[errorTracker] Critical error occurred but alerting is not configured ' +
        '(missing sendAlertFn or admin number):',
      entry.service,
      entry.message,
    );
    return;
  }

  const body =
    `🚨 *خطأ حرج*\n\n` +
    `الخدمة: ${entry.service}\n` +
    `الرسالة: ${entry.message}\n` +
    `الوقت: ${new Date(entry.timestamp).toISOString()}` +
    (entry.retryCount ? `\nعدد المحاولات: ${entry.retryCount}` : '');

  try {
    await state.sendAlertFn(state.adminNumber, body);
  } catch (alertError) {
    console.error(
      '[errorTracker] Failed to send critical-error WhatsApp alert:',
      alertError instanceof Error ? alertError.message : alertError,
    );
  }
}

export function trackError({
  service,
  severity = 'warning',
  error,
  retryCount,
  context,
}) {
  if (!service) {
    throw new Error('trackError requires a `service` name.');
  }

  const normalizedSeverity = SEVERITIES.has(severity) ? severity : 'warning';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';

  const entry = {
    service,
    severity: normalizedSeverity,
    message,
    timestamp: Date.now(),
    retryCount: typeof retryCount === 'number' ? retryCount : null,
    context: context ?? null,
  };

  state.errors.unshift(entry);
  if (state.errors.length > MAX_STORED_ERRORS) {
    state.errors.length = MAX_STORED_ERRORS;
  }

  if (normalizedSeverity === 'critical') {
    const signature = buildSignature(entry);
    if (shouldAlert(signature)) {
      state.lastAlertBySignature.set(signature, Date.now());
      sendCriticalAlert(entry).catch(() => {});
    }
  }

  return entry;
}

export function getRecentErrors({ limit, service, severity } = {}) {
  let results = state.errors;

  if (service) {
    results = results.filter((entry) => entry.service === service);
  }

  if (severity) {
    results = results.filter((entry) => entry.severity === severity);
  }

  if (typeof limit === 'number') {
    results = results.slice(0, limit);
  }

  return results;
}

export function __resetErrorTrackerForTests() {
  state.errors = [];
  state.sendAlertFn = null;
  state.adminNumber = null;
  state.lastAlertBySignature = new Map();
}
