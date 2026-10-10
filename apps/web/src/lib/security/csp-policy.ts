export const CSP_REPORT_GROUP = 'accensa-csp';
export const CSP_REPORT_ENDPOINT = '/api/security/csp-report';

export function buildContentSecurityPolicy(nonce: string, allowDevelopmentEval = false): string {
  const developmentEval = allowDevelopmentEval ? " 'unsafe-eval'" : '';
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentEval}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; connect-src 'self' https: wss:; upgrade-insecure-requests; report-uri ${CSP_REPORT_ENDPOINT}; report-to ${CSP_REPORT_GROUP}`;
}

export function reportingEndpointsHeader(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_ENDPOINT}"`;
}
