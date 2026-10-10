import { createHash } from 'node:crypto';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const MAX_FIELD_LENGTH = 512;
const WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 60;
const DEDUPE_MS = 10 * 60_000;

export interface CspViolation {
  documentUri: string;
  violatedDirective: string;
  effectiveDirective: string;
  blockedUri: string;
  sourceFile: string;
  lineNumber: number | null;
  statusCode: number | null;
}

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const limiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_REPORTS_PER_WINDOW, '60 s'),
      analytics: false,
      prefix: 'accensa:csp-report:limit',
    })
  : null;

const localHits = new Map<string, number[]>();
const localDedupe = new Map<string, number>();

function boundedString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_FIELD_LENGTH);
}

function safeUri(value: unknown): string {
  const uri = boundedString(value);
  if (!uri || uri === 'inline' || uri === 'eval') return uri;
  if (uri.startsWith('data:')) return 'data:';
  if (uri.startsWith('blob:')) return 'blob:';

  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.slice(0, MAX_FIELD_LENGTH);
  } catch {
    return uri;
  }
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function reportBody(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload) && payload.length > 0) {
    return recordFrom(recordFrom(payload[0])?.body);
  }
  const root = recordFrom(payload);
  if (!root) return null;

  const legacy = recordFrom(root['csp-report']);
  if (legacy) return legacy;

  const body = recordFrom(root.body);
  if (body) return body;

  return root;
}

function numberField(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function parseCspViolation(payload: unknown): CspViolation | null {
  const report = reportBody(payload);
  if (!report) return null;

  const violatedDirective = boundedString(
    report['violated-directive'] ??
      report.violatedDirective ??
      report['effective-directive'] ??
      report.effectiveDirective,
  );
  const effectiveDirective = boundedString(
    report['effective-directive'] ?? report.effectiveDirective ?? violatedDirective,
  );
  if (!violatedDirective || !/^[a-z-]+(?:\s+[a-z0-9*:/.'-]+)*$/i.test(violatedDirective)) {
    return null;
  }

  return {
    documentUri: safeUri(report['document-uri'] ?? report.documentURL ?? report.documentUri),
    violatedDirective,
    effectiveDirective,
    blockedUri: safeUri(report['blocked-uri'] ?? report.blockedURL ?? report.blockedUri),
    sourceFile: safeUri(report['source-file'] ?? report.sourceFile),
    lineNumber: numberField(report['line-number'] ?? report.lineNumber),
    statusCode: numberField(report['status-code'] ?? report.statusCode),
  };
}

export function cspViolationFingerprint(report: CspViolation): string {
  return createHash('sha256').update(JSON.stringify(report)).digest('hex');
}

export function isHighSeverityCspViolation(report: CspViolation): boolean {
  const directive = report.effectiveDirective.toLowerCase().split(/\s/, 1)[0];
  return (
    directive.startsWith('script-src') || directive === 'object-src' || directive === 'base-uri'
  );
}

export async function allowCspReport(clientKey: string, now = Date.now()): Promise<boolean> {
  const identifier = createHash('sha256').update(clientKey).digest('hex');
  if (limiter) {
    try {
      return (await limiter.limit(identifier)).success;
    } catch (error) {
      console.error('CSP report rate limiter failed; using process-local fallback:', error);
    }
  }

  const current = (localHits.get(identifier) ?? []).filter((hit) => hit > now - WINDOW_MS);
  if (current.length >= MAX_REPORTS_PER_WINDOW) {
    localHits.set(identifier, current);
    return false;
  }
  current.push(now);
  localHits.set(identifier, current);
  return true;
}

export async function claimCspReportFingerprint(
  fingerprint: string,
  now = Date.now(),
): Promise<boolean> {
  const key = `accensa:csp-report:dedupe:${fingerprint}`;
  if (redis) {
    try {
      return (await redis.set(key, '1', { nx: true, ex: DEDUPE_MS / 1000 })) === 'OK';
    } catch (error) {
      console.error('CSP report deduplication failed; using process-local fallback:', error);
    }
  }

  for (const [cached, expiresAt] of localDedupe) {
    if (expiresAt <= now) localDedupe.delete(cached);
  }
  if (localDedupe.has(fingerprint)) return false;
  localDedupe.set(fingerprint, now + DEDUPE_MS);
  return true;
}

export function resetCspReportStateForTests(): void {
  localHits.clear();
  localDedupe.clear();
}
