import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

/**
 * Status mapping for POST /api/inventory/reservations/[reservationId].
 *
 * route.ts:48 — `status: updated ? 200 : 409` — is the whole optimistic
 * concurrency contract the checkout client reacts to: a confirm against an
 * already-expired hold must be a 409, and the body must say `updated:
 * false` rather than arrive empty. Both outcomes come from the same stub
 * below with only `finish`'s flag flipped, so the contract is pinned in one
 * place. Everything is stubbed — no test here needs a live Postgres.
 */
const mocks = vi.hoisted(() => ({
  withClient: vi.fn(),
  withMerchantClient: vi.fn(),
  ensureSchema: vi.fn(),
  getMerchantById: vi.fn(),
  finish: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  ensureSchema: mocks.ensureSchema,
  withClient: mocks.withClient,
  withMerchantClient: mocks.withMerchantClient,
}));
vi.mock('@/lib/merchants', () => ({ getMerchantById: mocks.getMerchantById }));
vi.mock('@/lib/inventory/reservationManager', () => ({
  InventoryReservationManager: vi.fn(function () {
    return { finish: mocks.finish };
  }),
  PostgresInventoryReservationStore: vi.fn(),
}));

const RESERVATION_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const MERCHANT_ID = 7;

/** The arg convention route.ts declares: `{ params: Promise<...> }`. */
const params = (reservationId: string) => ({ params: Promise.resolve({ reservationId }) });

const jsonRequest = (body: unknown) =>
  new Request(`http://localhost/api/inventory/reservations/${RESERVATION_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const rawRequest = (body: string) =>
  new Request(`http://localhost/api/inventory/reservations/${RESERVATION_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

const update = (body: unknown) => POST(jsonRequest(body), params(RESERVATION_ID));

describe('POST /api/inventory/reservations/[reservationId]', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://test';
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mocks.withClient.mockImplementation(async (callback) => callback({}));
    mocks.withMerchantClient.mockImplementation(async (_merchantId, callback) => callback({}));
    mocks.ensureSchema.mockResolvedValue(undefined);
    mocks.getMerchantById.mockResolvedValue({ id: MERCHANT_ID, address: 'GTEST' });
    mocks.finish.mockResolvedValue(true);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('returns 200 with { updated: true } when the update lands', async () => {
    const response = await update({ merchantId: MERCHANT_ID, action: 'commit' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated: true });
    expect(mocks.finish).toHaveBeenCalledWith(MERCHANT_ID, RESERVATION_ID, 'commit');
    // Domain outcome: the catch at route.ts:49 is not entered, so the 500
    // path is reserved for non-domain errors.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 409 with { updated: false } when the manager reports the update did not land', async () => {
    mocks.finish.mockResolvedValue(false);

    const response = await update({ merchantId: MERCHANT_ID, action: 'commit' });

    expect(response.status).toBe(409);
    // The concurrency contract is the status *and* the body: an empty 409
    // would leave the client guessing whether anything happened.
    expect(await response.json()).toEqual({ updated: false });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown merchant without touching the reservation manager', async () => {
    mocks.getMerchantById.mockResolvedValue(null);

    const response = await update({ merchantId: MERCHANT_ID, action: 'release' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Merchant not found' });
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 400 Invalid reservation update for a body that is not an object (route.ts:24)', async () => {
    for (const raw of ['null', '"just a string"', '42']) {
      const response = await POST(rawRequest(raw), params(RESERVATION_ID));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid reservation update' });
    }
    expect(mocks.withClient).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 400 Invalid reservation update for a bad merchant id, action or reservation id (route.ts:33)', async () => {
    const rejected = [
      { body: { merchantId: 1.5, action: 'commit' }, reservationId: RESERVATION_ID },
      { body: { merchantId: 'seven', action: 'commit' }, reservationId: RESERVATION_ID },
      { body: { merchantId: MERCHANT_ID, action: 'delete' }, reservationId: RESERVATION_ID },
      { body: { merchantId: MERCHANT_ID, action: 'commit' }, reservationId: 'not-a-uuid' },
    ];
    for (const { body, reservationId } of rejected) {
      const response = await POST(jsonRequest(body), params(reservationId));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid reservation update' });
    }
    expect(mocks.withClient).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 400 Invalid JSON body for a body that does not parse (route.ts:20-21)', async () => {
    const response = await POST(rawRequest('{not json'), params(RESERVATION_ID));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(mocks.withClient).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('returns 503 with the database unconfigured, before any query runs', async () => {
    delete process.env.DATABASE_URL;

    const response = await update({ merchantId: MERCHANT_ID, action: 'commit' });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Inventory is unavailable' });
    expect(mocks.withClient).not.toHaveBeenCalled();
    expect(mocks.withMerchantClient).not.toHaveBeenCalled();
  });

  it('returns 500 for an unexpected throw, logging it through route.ts:49-51', async () => {
    const failure = new Error('connection reset before reply');
    mocks.getMerchantById.mockRejectedValue(failure);

    const response = await update({ merchantId: MERCHANT_ID, action: 'commit' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Inventory is unavailable' });
    expect(consoleError).toHaveBeenCalledWith('Unable to update inventory reservation:', failure);
  });
});
