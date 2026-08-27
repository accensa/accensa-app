import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isAuthorizedCronRequest } from './cron-auth';

describe('isAuthorizedCronRequest', () => {
  const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
  });

  describe('when CRON_SECRET is unset', () => {
    beforeEach(() => {
      delete process.env.CRON_SECRET;
    });

    it('rejects the literal header the unset secret used to produce', () => {
      // Regression case: `Bearer ${process.env.CRON_SECRET}` with the
      // variable unset used to render as this exact string, and a caller
      // sending it as a literal header compared equal.
      expect(isAuthorizedCronRequest('Bearer undefined')).toBe(false);
    });

    it('rejects a missing Authorization header', () => {
      expect(isAuthorizedCronRequest(null)).toBe(false);
    });

    it('rejects any other header value', () => {
      expect(isAuthorizedCronRequest('Bearer anything')).toBe(false);
    });
  });

  describe('when CRON_SECRET is set', () => {
    beforeEach(() => {
      process.env.CRON_SECRET = 'test-cron-secret-value';
    });

    it('accepts the matching bearer token', () => {
      expect(isAuthorizedCronRequest('Bearer test-cron-secret-value')).toBe(true);
    });

    it('rejects "Bearer undefined"', () => {
      expect(isAuthorizedCronRequest('Bearer undefined')).toBe(false);
    });

    it('rejects an incorrect token', () => {
      expect(isAuthorizedCronRequest('Bearer wrong-secret')).toBe(false);
    });

    it('rejects a missing Authorization header', () => {
      expect(isAuthorizedCronRequest(null)).toBe(false);
    });

    it('rejects a token that is a prefix or suffix of the real secret', () => {
      expect(isAuthorizedCronRequest('Bearer test-cron-secret-val')).toBe(false);
      expect(isAuthorizedCronRequest('Bearer test-cron-secret-value-extra')).toBe(false);
    });
  });
});
