/**
 * End-to-end coverage for the `attachAccensaHook` middleware over a real
 * Express server.
 *
 * `index.test.ts` drives the hook with fake `req`/`res` objects — fast, but it
 * proves nothing about how the hook behaves once Express' own request parsing,
 * header casing, and the `finish` event are in the loop. A subtle change to any
 * of those could silently stop the `X-PAYMENT-RESPONSE` header from being read,
 * and a merchant would lose attribution without an error anywhere.
 *
 * So this suite stands up an actual Express app: a stand-in x402 layer that
 * returns `402` until a payment is presented and then reports settlement via
 * the response header, `attachAccensaHook` mounted after it, and a Supertest
 * client making real HTTP requests. The Accensa indexer is the only mock — a
 * captured `fetch` — because the assertion is about the outbound report, not
 * about a running dashboard.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { SETTLEMENT_HEADER, SETTLE_ENDPOINT, attachAccensaHook } from './index';

/** A real Ed25519 seed — `reportSettlement` signs with `node:crypto`. */
function privateKeyHex(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  return der.subarray(16).toString('hex'); // strip the 16-byte PKCS#8 header
}

const PRIVATE_KEY_HEX = privateKeyHex();
const INDEXER_URL = 'https://accensa.test';
const TX_HASH = 'b'.repeat(64);

/** Base64-encoded x402 settle response, exactly as the header carries it. */
function encodeSettleHeader(result: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(result)).toString('base64');
}

/**
 * A stand-in for the x402 payment layer.
 *
 * No payment (`X-PAYMENT` absent) -> `402` with a challenge body, and no
 * settlement header. With a payment -> "settles", writes the base64 settle
 * response into `X-PAYMENT-RESPONSE`, and lets the request through.
 */
function x402Mock(req: Request, res: Response, next: NextFunction) {
  if (!req.header('X-PAYMENT')) {
    res.status(402).json({
      error: 'Payment Required',
      accepts: [{ scheme: 'exact', network: 'stellar:testnet' }],
    });
    return;
  }
  res.setHeader(
    SETTLEMENT_HEADER,
    encodeSettleHeader({
      success: true,
      transaction: TX_HASH,
      network: 'stellar:testnet',
      payer: 'G' + 'A'.repeat(55),
      amount: '2500000',
    }),
  );
  next();
}

/**
 * Resolves with the first `fetch` the SDK makes. `reportSettlement` is
 * deliberately not awaited by the middleware, so a test has to wait for the
 * outbound call rather than assume it has happened by the time the HTTP
 * response returns.
 */
function captureReport() {
  let resolve!: (call: { url: string; init: RequestInit }) => void;
  const captured = new Promise<{ url: string; init: RequestInit }>((r) => {
    resolve = r;
  });
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    resolve({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(null, { status: 200 });
  });
  return { fetchImpl, captured };
}

function buildApp(fetchImpl: typeof fetch, onError = vi.fn()): Express {
  const app = express();
  app.use(x402Mock);
  app.use(
    attachAccensaHook({
      indexerUrl: INDEXER_URL,
      privateKeyHex: PRIVATE_KEY_HEX,
      fetchImpl,
      onError,
    }),
  );
  app.get('/api/quote', (_req, res) => {
    res.json({ price: '2.5000000', asset: 'USDC' });
  });
  return app;
}

describe('x402 middleware e2e', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  test('an unpaid request gets a clean 402 and fires no report', async () => {
    const { fetchImpl } = captureReport();
    const app = buildApp(fetchImpl);

    const res = await request(app).get('/api/quote');

    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ error: 'Payment Required' });
    expect(res.headers[SETTLEMENT_HEADER.toLowerCase()]).toBeUndefined();

    // Give any stray async report a tick to not happen.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('a paid request is served and its settlement is reported to the indexer', async () => {
    const { fetchImpl, captured } = captureReport();
    const app = buildApp(fetchImpl);

    const res = await request(app).get('/api/quote').set('X-PAYMENT', 'proof-of-payment');

    // The challenge round-trip completed cleanly.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ price: '2.5000000' });
    // Supertest lower-cases header names; the value is the base64 the hook parses.
    const headerValue = res.headers[SETTLEMENT_HEADER.toLowerCase()];
    expect(typeof headerValue).toBe('string');
    expect(JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'))).toMatchObject({
      success: true,
      transaction: TX_HASH,
    });

    // The hook read that header off the finished response and reported it.
    const { url, init } = await captured;
    expect(url).toBe(`${INDEXER_URL}${SETTLE_ENDPOINT}`);
    expect(init.method).toBe('POST');

    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-signature')).toMatch(/^[0-9a-f]+$/i);

    expect(JSON.parse(init.body as string)).toMatchObject({
      tx_hash: TX_HASH,
      route: '/api/quote',
      method: 'GET',
      payer: 'G' + 'A'.repeat(55),
      amount: '2500000',
      network: 'stellar:testnet',
    });
  });

  test('a custom `attribute` fn sets the reported route', async () => {
    const { fetchImpl, captured } = captureReport();
    const app = express();
    app.use(x402Mock);
    app.use(
      attachAccensaHook({
        indexerUrl: INDEXER_URL,
        privateKeyHex: PRIVATE_KEY_HEX,
        fetchImpl,
        attribute: () => ({ route: '/api/quote/:symbol', method: 'GET' }),
      }),
    );
    app.get('/api/quote/:symbol', (_req, res) => res.json({ ok: true }));

    await request(app).get('/api/quote/XLM').set('X-PAYMENT', 'proof');

    const { init } = await captured;
    expect(JSON.parse(init.body as string).route).toBe('/api/quote/:symbol');
  });

  test('a report that fails delivery surfaces through onError, not as a crash', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('network down');
    });
    const app = buildApp(fetchImpl, onError);

    const res = await request(app).get('/api/quote').set('X-PAYMENT', 'proof');
    expect(res.status).toBe(200); // the paid request still succeeds

    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][1]).toMatchObject({ tx_hash: TX_HASH });
  });
});
