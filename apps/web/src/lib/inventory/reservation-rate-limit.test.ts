import { beforeEach, describe, expect, it } from 'vitest';
import {
  allowInventoryReservation,
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
});
