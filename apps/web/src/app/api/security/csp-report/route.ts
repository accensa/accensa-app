import { after } from 'next/server';
import {
  allowCspReport,
  claimCspReportFingerprint,
  cspViolationFingerprint,
  isHighSeverityCspViolation,
  parseCspViolation,
} from '@/lib/security/csp-report';
import { alertCspViolation } from '@/lib/security/alerting';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 16 * 1024;

function emptyResponse(): Response {
  return new Response(null, { status: 204 });
}

async function readLimitedBody(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function POST(request: Request): Promise<Response> {
  const body = await readLimitedBody(request);
  if (body === null) return emptyResponse();

  const clientKey =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  if (!(await allowCspReport(clientKey.split(',')[0].trim()))) return emptyResponse();

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return emptyResponse();
  }

  const report = parseCspViolation(payload);
  if (!report) return emptyResponse();

  const fingerprint = cspViolationFingerprint(report);
  if (!(await claimCspReportFingerprint(fingerprint))) return emptyResponse();

  console.warn(JSON.stringify({ level: 'warn', event: 'csp_violation', ...report }));
  if (isHighSeverityCspViolation(report)) {
    after(() => alertCspViolation(report));
  }

  return emptyResponse();
}
