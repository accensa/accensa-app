import { beforeEach, describe, expect, it } from 'vitest';
import {
  allowInventoryReservation,
  getLocalHitsSizeForTests,
  MAX_TRACKED_CLIENTS,
  resetInventoryReservationLimitsForTests,
} from './reservation-rate-limit';

describe('inventory reservation rate limit', () => {
  beforeEach(() => resetInventoryReservationLimitsForTests());

  it('limits a client per store without blocking a different client or store', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(await allowInventoryReservation(1, '203.0.113.4', 1000)).toBe(true);
    }
    expect(await allowInventoryReservation(1, '203.0.113.4', 1000)).toBe(false);
    expect(await allowInventoryReservation(1, '203.0.113.5', 1000)).toBe(true);
    expect(await allowInventoryReservation(2, '203.0.113.4', 1000)).toBe(true);
    expect(await allowInventoryReservation(1, '203.0.113.4', 61_001)).toBe(true);
  });

  it('drops a tracked client once its whole window has expired', async () => {
    expect(await allowInventoryReservation(1, '203.0.113.10', 1_000)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(1);

    expect(await allowInventoryReservation(1, '203.0.113.11', 61_002)).toBe(true);

    // The stale client was swept; only the new client is tracked.
    expect(getLocalHitsSizeForTests()).toBe(1);
  });

  it('reopens the window for the same client without retaining an empty hit list', async () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(await allowInventoryReservation(1, '203.0.113.12', 1_000)).toBe(true);
    }
    expect(await allowInventoryReservation(1, '203.0.113.12', 1_000)).toBe(false);
    expect(getLocalHitsSizeForTests()).toBe(1);

    expect(await allowInventoryReservation(1, '203.0.113.12', 61_001)).toBe(true);
    expect(getLocalHitsSizeForTests()).toBe(1);
  });

  it('bounds the number of tracked clients', async () => {
    for (let client = 0; client < MAX_TRACKED_CLIENTS + 25; client += 1) {
      expect(await allowInventoryReservation(1, `198.51.100.${client}`, 1_000)).toBe(true);
    }

    expect(getLocalHitsSizeForTests()).toBe(MAX_TRACKED_CLIENTS);
  });
});
