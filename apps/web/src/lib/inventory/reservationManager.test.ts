import { describe, expect, it } from 'vitest';
import {
  InventoryReservationManager,
  INVENTORY_RESERVATION_TTL_MS,
  type InventoryLine,
  type InventoryReservationStore,
  type InventoryStock,
} from './reservationManager';

type Reservation = {
  id: string;
  merchantId: number;
  checkoutId: string;
  expiresAt: string;
  status: 'active' | 'committed' | 'released' | 'expired';
  items: InventoryLine[];
};

class MemoryInventoryStore implements InventoryReservationStore {
  readonly stock = new Map<string, { name: string; quantity: number; threshold: number }>();
  readonly reservations = new Map<string, Reservation>();
  private queue = Promise.resolve();

  constructor(initialStock: number) {
    this.stock.set('1:sku-1', { name: 'One item', quantity: initialStock, threshold: 3 });
  }

  async transaction<T>(work: (tx: never) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let unlock = () => {};
    this.queue = new Promise<void>((resolve) => (unlock = resolve));
    await previous;
    try {
      const tx = {
        expireReservations: async (merchantId: number, now: string) => {
          for (const reservation of this.reservations.values()) {
            if (
              reservation.merchantId === merchantId &&
              reservation.status === 'active' &&
              Date.parse(reservation.expiresAt) <= Date.parse(now)
            ) {
              reservation.status = 'expired';
            }
          }
        },
        lockStock: async (merchantId: number, sku: string) => {
          const stock = this.stock.get(`${merchantId}:${sku}`);
          return stock
            ? { stockQuantity: stock.quantity, lowStockThreshold: stock.threshold }
            : null;
        },
        activeQuantity: async (merchantId: number, sku: string, now: string) =>
          [...this.reservations.values()]
            .filter(
              (reservation) =>
                reservation.merchantId === merchantId &&
                reservation.status === 'active' &&
                Date.parse(reservation.expiresAt) > Date.parse(now),
            )
            .flatMap((reservation) => reservation.items)
            .filter((item) => item.sku === sku)
            .reduce((sum, item) => sum + item.quantity, 0),
        findByCheckout: async (merchantId: number, checkoutId: string) => {
          const match = [...this.reservations.values()].find(
            (reservation) =>
              reservation.merchantId === merchantId && reservation.checkoutId === checkoutId,
          );
          return match ? { id: match.id, status: match.status, expiresAt: match.expiresAt } : null;
        },
        reservationLines: async (reservationId: string) =>
          this.reservations.get(reservationId)?.items ?? [],
        createReservation: async (input: {
          id: string;
          merchantId: number;
          checkoutId: string;
          expiresAt: string;
          lines: InventoryLine[];
        }) => {
          this.reservations.set(input.id, {
            id: input.id,
            merchantId: input.merchantId,
            checkoutId: input.checkoutId,
            expiresAt: input.expiresAt,
            status: 'active',
            items: input.lines,
          });
        },
        lockReservation: async (merchantId: number, reservationId: string) => {
          const reservation = this.reservations.get(reservationId);
          return reservation?.merchantId === merchantId
            ? { id: reservation.id, status: reservation.status, expiresAt: reservation.expiresAt }
            : null;
        },
        ensureStockItem: async (merchantId: number, sku: string, name: string) => {
          const key = `${merchantId}:${sku}`;
          if (!this.stock.has(key)) this.stock.set(key, { name, quantity: 0, threshold: 0 });
        },
        updateStock: async (
          merchantId: number,
          sku: string,
          name: string,
          quantity: number,
          threshold: number,
        ) => {
          this.stock.set(`${merchantId}:${sku}`, { name, quantity, threshold });
        },
        decrementStock: async (merchantId: number, sku: string, quantity: number) => {
          const stock = this.stock.get(`${merchantId}:${sku}`);
          if (!stock || stock.quantity < quantity) return false;
          stock.quantity -= quantity;
          return true;
        },
        updateReservationStatus: async (reservationId: string, status: Reservation['status']) => {
          const reservation = this.reservations.get(reservationId);
          if (reservation) reservation.status = status;
        },
      };
      return await work(tx as never);
    } finally {
      unlock();
    }
  }

  async listStock(
    merchantId: number,
    skus: string[] | null,
    now: string,
  ): Promise<InventoryStock[]> {
    return [...this.stock.entries()]
      .filter(([key]) => key.startsWith(`${merchantId}:`))
      .map(([key, item]) => {
        const sku = key.slice(key.indexOf(':') + 1);
        const reserved = [...this.reservations.values()]
          .filter(
            (reservation) =>
              reservation.merchantId === merchantId &&
              reservation.status === 'active' &&
              Date.parse(reservation.expiresAt) > Date.parse(now),
          )
          .flatMap((reservation) => reservation.items)
          .filter((line) => line.sku === sku)
          .reduce((sum, line) => sum + line.quantity, 0);
        return {
          sku,
          name: item.name,
          stockQuantity: item.quantity,
          lowStockThreshold: item.threshold,
          available: Math.max(0, item.quantity - reserved),
        };
      })
      .filter((item) => !skus || skus.includes(item.sku));
  }

  async expireReservations(merchantId: number, now: string): Promise<void> {
    for (const reservation of this.reservations.values()) {
      if (
        reservation.merchantId === merchantId &&
        reservation.status === 'active' &&
        Date.parse(reservation.expiresAt) <= Date.parse(now)
      ) {
        reservation.status = 'expired';
      }
    }
  }
}

describe('InventoryReservationManager', () => {
  it('allows only one concurrent checkout to reserve the last unit', async () => {
    let now = 1_000;
    const store = new MemoryInventoryStore(1);
    const manager = new InventoryReservationManager(store, () => now);
    const input = (checkoutId: string) => ({
      merchantId: 1,
      checkoutId,
      items: [{ sku: 'sku-1', quantity: 1 }],
    });

    const results = await Promise.all([
      manager.reserve(input('checkout-session-0001')),
      manager.reserve(input('checkout-session-0002')),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === 'out_of_stock')).toHaveLength(
      1,
    );
    expect((await manager.stockLevels(1))[0].available).toBe(0);

    now += INVENTORY_RESERVATION_TTL_MS + 1;
    expect((await manager.stockLevels(1))[0].available).toBe(1);
    expect([...store.reservations.values()][0].status).toBe('expired');
  });

  it('releases abandoned holds and decrements stock only on successful commit', async () => {
    const store = new MemoryInventoryStore(3);
    const manager = new InventoryReservationManager(store, () => 5_000);
    const held = await manager.reserve({
      merchantId: 1,
      checkoutId: 'checkout-session-0003',
      items: [{ sku: 'sku-1', quantity: 2 }],
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect((await manager.stockLevels(1))[0].available).toBe(1);

    expect(await manager.finish(1, held.reservationId, 'release')).toBe(true);
    expect((await manager.stockLevels(1))[0].available).toBe(3);
  });
});
