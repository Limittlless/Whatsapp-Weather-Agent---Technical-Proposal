const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const RETRYABLE_NODE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const RETRYABLE_MESSAGE_PATTERNS = [
  /timed?\s?out/i,
  /timeout/i,
  /rate limit/i,
  /RESOURCE_EXHAUSTED/,
  /UNAVAILABLE/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /network error/i,
  /fetch failed/i,
];

function extractStatusCode(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'number') {
      return candidate;
    }
  }

  return null;
}

export function defaultIsRetryable(error) {
  const status = extractStatusCode(error);

  if (status !== null) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const code = error?.code;
  if (typeof code === 'string' && RETRYABLE_NODE_ERROR_CODES.has(code)) {
    return true;
  }

  if (error?.name === 'AbortError') {
    return true;
  }

  const message =
    typeof error?.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs) {
  const cappedExponential = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return Math.random() * cappedExponential;
}

export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 5000,
    isRetryable = defaultIsRetryable,
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const attemptsRemaining = maxAttempts - attempt - 1;
      const canRetry = attemptsRemaining > 0 && isRetryable(error);

      if (!canRetry) {
        onRetry?.({ error, attempt, willRetry: false, delayMs: null });
        throw error;
      }

      const delayMs = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
      onRetry?.({ error, attempt, willRetry: true, delayMs });

      await sleep(delayMs);
    }
  }

  throw lastError;
}
