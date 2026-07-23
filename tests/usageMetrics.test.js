import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordGeminiCall,
  getUsageSnapshot,
  __resetUsageForTests,
} from '../src/services/usageMetrics.js';

describe('usageMetrics', () => {
  beforeEach(() => {
    __resetUsageForTests();
    delete process.env.GEMINI_RPM_LIMIT;
    delete process.env.GEMINI_RPD_LIMIT;
  });

  it('starts with zeroed counters', () => {
    const snapshot = getUsageSnapshot();

    expect(snapshot.geminiCallsTotal).toBe(0);
    expect(snapshot.geminiCallsOk).toBe(0);
    expect(snapshot.geminiCallsFailed).toBe(0);
    expect(snapshot.lastGeminiError).toBeNull();
    expect(snapshot.lastGeminiCallAt).toBeNull();
  });

  it('records a successful call', () => {
    recordGeminiCall({ ok: true });

    const snapshot = getUsageSnapshot();

    expect(snapshot.geminiCallsTotal).toBe(1);
    expect(snapshot.geminiCallsOk).toBe(1);
    expect(snapshot.geminiCallsFailed).toBe(0);
    expect(snapshot.lastGeminiCallAt).not.toBeNull();
    expect(snapshot.callsLastMinute).toBe(1);
    expect(snapshot.callsLast24h).toBe(1);
  });

  it('records a failed call with its error message', () => {
    recordGeminiCall({ ok: false, error: new Error('quota exceeded') });

    const snapshot = getUsageSnapshot();

    expect(snapshot.geminiCallsTotal).toBe(1);
    expect(snapshot.geminiCallsFailed).toBe(1);
    expect(snapshot.lastGeminiError).toMatchObject({
      message: 'quota exceeded',
    });
  });

  it('handles a non-Error failure value', () => {
    recordGeminiCall({ ok: false, error: 'raw string failure' });

    const snapshot = getUsageSnapshot();

    expect(snapshot.lastGeminiError.message).toBe('raw string failure');
  });

  it('accumulates multiple calls independently', () => {
    recordGeminiCall({ ok: true });
    recordGeminiCall({ ok: true });
    recordGeminiCall({ ok: false, error: new Error('boom') });

    const snapshot = getUsageSnapshot();

    expect(snapshot.geminiCallsTotal).toBe(3);
    expect(snapshot.geminiCallsOk).toBe(2);
    expect(snapshot.geminiCallsFailed).toBe(1);
    expect(snapshot.callsLast24h).toBe(3);
  });

  it('surfaces configured RPM/RPD limits from env when set', () => {
    process.env.GEMINI_RPM_LIMIT = '60';
    process.env.GEMINI_RPD_LIMIT = '1000';

    const snapshot = getUsageSnapshot();

    expect(snapshot.rpmLimit).toBe(60);
    expect(snapshot.rpdLimit).toBe(1000);
  });

  it('returns null limits when env vars are absent or invalid', () => {
    process.env.GEMINI_RPM_LIMIT = 'not-a-number';

    const snapshot = getUsageSnapshot();

    expect(snapshot.rpmLimit).toBeNull();
    expect(snapshot.rpdLimit).toBeNull();
  });

  it('excludes calls older than 24h from the rolling window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    recordGeminiCall({ ok: true });

    vi.setSystemTime(new Date('2026-01-02T01:00:00Z'));

    const snapshot = getUsageSnapshot();

    expect(snapshot.callsLast24h).toBe(0);

    vi.useRealTimers();
  });

  it('excludes calls older than 1 minute from the per-minute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    recordGeminiCall({ ok: true });

    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));

    const snapshot = getUsageSnapshot();

    expect(snapshot.callsLastMinute).toBe(0);
    expect(snapshot.callsLast24h).toBe(1);

    vi.useRealTimers();
  });
});
