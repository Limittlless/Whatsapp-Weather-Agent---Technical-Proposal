import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  trackError,
  getRecentErrors,
  configureErrorTracker,
  __resetErrorTrackerForTests,
} from '../src/services/errorTracker.js';

describe('errorTracker', () => {
  beforeEach(() => {
    __resetErrorTrackerForTests();
  });

  describe('trackError / getRecentErrors', () => {
    it('records an error with a normalized shape', () => {
      trackError({
        service: 'weather',
        severity: 'warning',
        error: new Error('boom'),
        retryCount: 1,
        context: { latitude: 1, longitude: 2 },
      });

      const [entry] = getRecentErrors();
      expect(entry).toMatchObject({
        service: 'weather',
        severity: 'warning',
        message: 'boom',
        retryCount: 1,
        context: { latitude: 1, longitude: 2 },
      });
      expect(typeof entry.timestamp).toBe('number');
    });

    it('requires a service name', () => {
      expect(() => trackError({ error: new Error('x') })).toThrow(
        /service/i,
      );
    });

    it('defaults to "warning" severity when omitted', () => {
      trackError({ service: 'gemini', error: new Error('x') });
      expect(getRecentErrors()[0].severity).toBe('warning');
    });

    it('falls back to "warning" for an unrecognized severity value', () => {
      trackError({ service: 'gemini', severity: 'yikes', error: new Error('x') });
      expect(getRecentErrors()[0].severity).toBe('warning');
    });

    it('stores a string error as-is when not an Error instance', () => {
      trackError({ service: 'gemini', error: 'plain string error' });
      expect(getRecentErrors()[0].message).toBe('plain string error');
    });

    it('falls back to "Unknown error" for unrecognized error shapes', () => {
      trackError({ service: 'gemini', error: { weird: true } });
      expect(getRecentErrors()[0].message).toBe('Unknown error');
    });

    it('returns errors newest-first', () => {
      trackError({ service: 'a', error: new Error('first') });
      trackError({ service: 'b', error: new Error('second') });

      const results = getRecentErrors();
      expect(results[0].message).toBe('second');
      expect(results[1].message).toBe('first');
    });

    it('caps stored errors at the ring-buffer limit', () => {
      for (let i = 0; i < 60; i += 1) {
        trackError({ service: 'gemini', error: new Error(`err-${i}`) });
      }

      const results = getRecentErrors();
      expect(results.length).toBeLessThanOrEqual(50);

      expect(results[0].message).toBe('err-59');
    });

    it('filters by service, severity, and limit', () => {
      trackError({ service: 'weather', severity: 'warning', error: new Error('w1') });
      trackError({ service: 'gemini', severity: 'critical', error: new Error('g1') });
      trackError({ service: 'weather', severity: 'critical', error: new Error('w2') });

      expect(getRecentErrors({ service: 'weather' })).toHaveLength(2);
      expect(getRecentErrors({ severity: 'critical' })).toHaveLength(2);
      expect(
        getRecentErrors({ service: 'weather', severity: 'critical' }),
      ).toHaveLength(1);
      expect(getRecentErrors({ limit: 1 })).toHaveLength(1);
    });
  });

  describe('critical alerting', () => {
    it('does not throw and just logs when alerting is not configured', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() =>
        trackError({
          service: 'supabase',
          severity: 'critical',
          error: new Error('db down'),
        }),
      ).not.toThrow();

      expect(warnSpy).toHaveBeenCalled();
    });

    it('sends an alert via sendAlertFn for a critical error', async () => {
      const sendAlertFn = vi.fn().mockResolvedValue(undefined);
      configureErrorTracker({ sendAlertFn, adminNumber: '212600000001' });

      trackError({
        service: 'whatsapp',
        severity: 'critical',
        error: new Error('send failed'),
        retryCount: 2,
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(sendAlertFn).toHaveBeenCalledTimes(1);
      const [to, body] = sendAlertFn.mock.calls[0];
      expect(to).toBe('212600000001');
      expect(body).toContain('whatsapp');
      expect(body).toContain('send failed');
    });

    it('does not alert for non-critical severities', async () => {
      const sendAlertFn = vi.fn().mockResolvedValue(undefined);
      configureErrorTracker({ sendAlertFn, adminNumber: '212600000001' });

      trackError({ service: 'weather', severity: 'warning', error: new Error('x') });
      trackError({ service: 'weather', severity: 'info', error: new Error('y') });

      await Promise.resolve();
      await Promise.resolve();

      expect(sendAlertFn).not.toHaveBeenCalled();
    });

    it('de-duplicates repeated identical critical errors within the cooldown window', async () => {
      const sendAlertFn = vi.fn().mockResolvedValue(undefined);
      configureErrorTracker({ sendAlertFn, adminNumber: '212600000001' });

      for (let i = 0; i < 5; i += 1) {
        trackError({
          service: 'supabase',
          severity: 'critical',
          error: new Error('same failure every time'),
        });
      }

      await Promise.resolve();
      await Promise.resolve();

      expect(getRecentErrors({ service: 'supabase' })).toHaveLength(5);
      expect(sendAlertFn).toHaveBeenCalledTimes(1);
    });

    it('alerts again for a different error signature even within the cooldown window', async () => {
      const sendAlertFn = vi.fn().mockResolvedValue(undefined);
      configureErrorTracker({ sendAlertFn, adminNumber: '212600000001' });

      trackError({ service: 'supabase', severity: 'critical', error: new Error('A') });
      trackError({ service: 'supabase', severity: 'critical', error: new Error('B') });

      await Promise.resolve();
      await Promise.resolve();

      expect(sendAlertFn).toHaveBeenCalledTimes(2);
    });

    it('does not throw trackError even if sendAlertFn rejects', async () => {
      const sendAlertFn = vi.fn().mockRejectedValue(new Error('alert send failed'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      configureErrorTracker({ sendAlertFn, adminNumber: '212600000001' });

      expect(() =>
        trackError({
          service: 'whatsapp',
          severity: 'critical',
          error: new Error('primary failure'),
        }),
      ).not.toThrow();

      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalled();
    });

    it('falls back to ADMIN_ALERT_WHATSAPP_NUMBER env var when no adminNumber is passed', async () => {
      const sendAlertFn = vi.fn().mockResolvedValue(undefined);
      const original = process.env.ADMIN_ALERT_WHATSAPP_NUMBER;
      process.env.ADMIN_ALERT_WHATSAPP_NUMBER = '212699999999';

      configureErrorTracker({ sendAlertFn });

      trackError({ service: 'gemini', severity: 'critical', error: new Error('x') });

      await Promise.resolve();
      await Promise.resolve();

      expect(sendAlertFn).toHaveBeenCalledWith(
        '212699999999',
        expect.any(String),
      );

      process.env.ADMIN_ALERT_WHATSAPP_NUMBER = original;
    });
  });
});
