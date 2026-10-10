import { describe, expect, it } from 'vitest';
import {
  buildContentSecurityPolicy,
  CSP_REPORT_ENDPOINT,
  CSP_REPORT_GROUP,
  reportingEndpointsHeader,
} from './csp-policy';

describe('CSP reporting policy', () => {
  it('preserves the nonce policy and registers both report formats', () => {
    const policy = buildContentSecurityPolicy('test-nonce');

    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain(`report-uri ${CSP_REPORT_ENDPOINT}`);
    expect(policy).toContain(`report-to ${CSP_REPORT_GROUP}`);
    expect(reportingEndpointsHeader()).toBe(`${CSP_REPORT_GROUP}="${CSP_REPORT_ENDPOINT}"`);
  });

  it('allows eval only when explicitly building the development policy', () => {
    expect(buildContentSecurityPolicy('prod-nonce')).not.toContain("'unsafe-eval'");
    expect(buildContentSecurityPolicy('dev-nonce', true)).toContain("'unsafe-eval'");
  });
});
