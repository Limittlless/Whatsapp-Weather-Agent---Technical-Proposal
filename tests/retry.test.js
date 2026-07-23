import { describe, it, expect, vi, afterEach } from 'vitest';

import { withRetry, defaultIsRetryable } from '../src/lib/retry.js';

describe('defaultIsRetryable', () => {
  it('treats common retryable HTTP status codes as retryable', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(defaultIsRetryable({ status })).toBe(true);
    }
  });

  it('treats client errors as non-retryable', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(defaultIsRetryable({ status })).toBe(false);
    }
  });

  it('reads status from nested response/cause shapes', () => {
    expect(defaultIsRetryable({ response: { status: 503 } })).toBe(true);
    expect(defaultIsRetryable({ cause: { status: 429 } })).toBe(true);
    expect(defaultIsRetryable({ response: { status: 404 } })).toBe(false);
  });

  it('treats known Node/network error codes as retryable', () => {
    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
      const error = new Error('network blip');
      error.code = code;
      expect(defaultIsRetryable(error)).toBe(true);
    }
  });

  it('does not confuse a numeric-looking string code with a status', () => {
    const error = new Error('weird');
    error.code = 'SOME_UNKNOWN_CODE';
    expect(defaultIsRetryable(error)).toBe(false);
  });

  it('treats AbortError as retryable', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(defaultIsRetryable(error)).toBe(true);
  });

  it('matches retryable keywords in the message as a fallback', () => {
    expect(defaultIsRetryable(new Error('request timed out'))).toBe(true);
    expect(defaultIsRetryable(new Error('rate limit exceeded'))).toBe(true);
    expect(defaultIsRetryable(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(defaultIsRetryable(new Error('service UNAVAILABLE'))).toBe(true);
  });

  it('does not retry a plain, unrecognized error', () => {
    expect(defaultIsRetryable(new Error('Gemini service unavailable is fake'))).toBe(
      false,
    );
    expect(defaultIsRetryable(new Error('Something went wrong'))).toBe(false);
  });

  it('handles non-Error thrown values without crashing', () => {
    expect(defaultIsRetryable('just a string')).toBe(false);
    expect(defaultIsRetryable(undefined)).toBe(false);
    expect(defaultIsRetryable(null)).toBe(false);
  });
});

describe('withRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the result immediately on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails fast (no retry) on a non-retryable error', async () => {
    const error = new Error('bad request');
    error.status = 400;
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn)).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error and succeeds on a later attempt', async () => {
    const retryableError = new Error('temporarily unavailable');
    retryableError.status = 503;

    const fn = vi
      .fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce('recovered');

    const result = await withRetry(fn, {
      baseDelayMs: 1,
      maxDelayMs: 5,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts and throws the last error', async () => {
    const retryableError = new Error('still down');
    retryableError.status = 503;

    const fn = vi.fn().mockRejectedValue(retryableError);

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('still down');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('respects a custom isRetryable classifier', async () => {
    const customError = new Error('custom-flagged');
    const fn = vi.fn().mockRejectedValue(customError);

    await expect(
      withRetry(fn, {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 5,
        isRetryable: (error) => error.message === 'custom-flagged',
      }),
    ).rejects.toThrow('custom-flagged');

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry with attempt info before each retry, and once (no delay) on final failure', async () => {
    const retryableError = new Error('flaky');
    retryableError.status = 500;

    const fn = vi.fn().mockRejectedValue(retryableError);
    const onRetry = vi.fn();

    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 5,
        onRetry,
      }),
    ).rejects.toThrow('flaky');

    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 0, willRetry: true });
    expect(onRetry.mock.calls[1][0]).toMatchObject({ attempt: 1, willRetry: true });
    expect(onRetry.mock.calls[2][0]).toMatchObject({
      attempt: 2,
      willRetry: false,
      delayMs: null,
    });
  });

  it('never retries more than maxAttempts - 1 times regardless of error type', async () => {
    const retryableError = new Error('always fails');
    retryableError.status = 429;

    const fn = vi.fn().mockRejectedValue(retryableError);

    await expect(
      withRetry(fn, { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 5 }),
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
