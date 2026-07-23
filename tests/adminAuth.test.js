import { describe, it, expect } from 'vitest';
import { isAdminNumber, getAdminNumbers } from '../src/services/adminAuth.js';

describe('adminAuth', () => {
  describe('getAdminNumbers', () => {
    it('parses a comma-separated list', () => {
      const env = { ADMIN_WHATSAPP_NUMBERS: '212600000000,212611111111' };

      expect(getAdminNumbers(env)).toEqual([
        '212600000000',
        '212611111111',
      ]);
    });

    it('trims whitespace around entries', () => {
      const env = {
        ADMIN_WHATSAPP_NUMBERS: ' 212600000000 , 212611111111 ',
      };

      expect(getAdminNumbers(env)).toEqual([
        '212600000000',
        '212611111111',
      ]);
    });

    it('drops empty entries from stray commas', () => {
      const env = { ADMIN_WHATSAPP_NUMBERS: '212600000000,,212611111111,' };

      expect(getAdminNumbers(env)).toEqual([
        '212600000000',
        '212611111111',
      ]);
    });

    it('returns an empty list when unset', () => {
      expect(getAdminNumbers({})).toEqual([]);
    });

    it('supports a single admin number', () => {
      const env = { ADMIN_WHATSAPP_NUMBERS: '212600000000' };

      expect(getAdminNumbers(env)).toEqual(['212600000000']);
    });
  });

  describe('isAdminNumber', () => {
    const env = { ADMIN_WHATSAPP_NUMBERS: '212600000000,212611111111' };

    it('returns true for a listed admin number', () => {
      expect(isAdminNumber('212600000000', env)).toBe(true);
      expect(isAdminNumber('212611111111', env)).toBe(true);
    });

    it('returns false for a number not on the list', () => {
      expect(isAdminNumber('212699999999', env)).toBe(false);
    });

    it('returns false for empty/undefined input', () => {
      expect(isAdminNumber('', env)).toBe(false);
      expect(isAdminNumber(undefined, env)).toBe(false);
    });

    it('returns false when no admin numbers are configured at all', () => {
      expect(isAdminNumber('212600000000', {})).toBe(false);
    });
  });
});
