import { describe, it, expect } from 'vitest';
import { verifyAuth, verifyToken, extractMerchantId } from './verify-auth';

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function createToken(payload: object, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const encodedSignature = Buffer.from(signature)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${encodedSignature}`;
}

describe('verify-auth', () => {
  const secret = 'test-secret-key-1234567890';
  const issuer = 'test-issuer';

  describe('verifyAuth', () => {
    it('rejects a missing Authorization header', async () => {
      const req = new Request('https://example.com/api', { headers: {} });
      const result = await verifyAuth(req, { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'No authorization header' });
    });

    it('rejects a header that does not start with Bearer', async () => {
      const req = new Request('https://example.com/api', {
        headers: { authorization: 'Basic token123' },
      });
      const result = await verifyAuth(req, { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'Invalid authorization format' });
    });

    it('rejects a header with incorrect parts', async () => {
      const req = new Request('https://example.com/api', {
        headers: { authorization: 'Bearer' },
      });
      const result = await verifyAuth(req, { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'Invalid authorization format' });
    });
  });

  describe('verifyToken', () => {
    it('rejects a token that does not have three parts', async () => {
      const result = await verifyToken('header.payload', { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'Invalid token format' });
    });

    it('rejects a token with an expired timestamp beyond clockTolerance', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createToken({ exp: now - 60, iss: issuer }, secret);
      const result = await verifyToken(token, { secret, issuer, clockTolerance: 10 });
      expect(result).toEqual({ valid: false, error: 'Token expired', expiresAt: now - 60 });
    });

    it('rejects an issuer mismatch', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createToken({ exp: now + 60, iss: 'wrong-issuer' }, secret);
      const result = await verifyToken(token, { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'Invalid issuer' });
    });

    it('rejects a token signed with a different secret', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createToken(
        { exp: now + 60, iss: issuer },
        'wrong-secret-key-1234567890',
      );
      const result = await verifyToken(token, { secret, issuer });
      expect(result).toEqual({ valid: false, error: 'Invalid signature' });
    });

    it('successfully verifies a valid signed token', async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await createToken({ exp: now + 60, iss: issuer, merchantId: 'm-1' }, secret);
      const result = await verifyToken(token, { secret, issuer });
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
    });

    it('catches malformed base64url/JSON payloads and returns valid false', async () => {
      const result = await verifyToken('notbase64.badjson.sig', { secret, issuer });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('extractMerchantId', () => {
    it('prefers merchantId, then sub, then null', () => {
      expect(extractMerchantId({ merchantId: '123', sub: '456' })).toBe('123');
      expect(extractMerchantId({ sub: '456' })).toBe('456');
      expect(extractMerchantId({})).toBeNull();
    });
  });
});
