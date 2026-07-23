const processStartedAt = Date.now();

const state = {
  geminiCallsTotal: 0,
  geminiCallsOk: 0,
  geminiCallsFailed: 0,
  lastGeminiError: null,
  lastGeminiCallAt: null,
  callTimestamps: [],
};

const ONE_MINUTE_MS = 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function pruneOldTimestamps(now) {
  const cutoff = now - ONE_DAY_MS;
  while (state.callTimestamps.length > 0 && state.callTimestamps[0] < cutoff) {
    state.callTimestamps.shift();
  }
}

export function recordGeminiCall({ ok, error } = {}) {
  const now = Date.now();

  state.geminiCallsTotal += 1;
  state.lastGeminiCallAt = now;

  if (ok) {
    state.geminiCallsOk += 1;
  } else {
    state.geminiCallsFailed += 1;
    state.lastGeminiError = {
      message: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      at: now,
    };
  }

  state.callTimestamps.push(now);
  pruneOldTimestamps(now);
}

export function getUsageSnapshot() {
  const now = Date.now();
  pruneOldTimestamps(now);

  const callsLastMinute = state.callTimestamps.filter(
    (t) => t > now - ONE_MINUTE_MS
  ).length;
  const callsLast24h = state.callTimestamps.length;

  const rpmLimit = Number(process.env.GEMINI_RPM_LIMIT) || null;
  const rpdLimit = Number(process.env.GEMINI_RPD_LIMIT) || null;

  return {
    uptimeMs: now - processStartedAt,
    geminiCallsTotal: state.geminiCallsTotal,
    geminiCallsOk: state.geminiCallsOk,
    geminiCallsFailed: state.geminiCallsFailed,
    lastGeminiError: state.lastGeminiError,
    lastGeminiCallAt: state.lastGeminiCallAt,
    callsLastMinute,
    callsLast24h,
    rpmLimit,
    rpdLimit,
  };
}

export function __resetUsageForTests() {
  state.geminiCallsTotal = 0;
  state.geminiCallsOk = 0;
  state.geminiCallsFailed = 0;
  state.lastGeminiError = null;
  state.lastGeminiCallAt = null;
  state.callTimestamps = [];
}
