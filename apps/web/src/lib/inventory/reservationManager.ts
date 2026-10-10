import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export const INVENTORY_RESERVATION_TTL_MS = 10 * 60 * 1000;

export interface InventoryLine {
  sku: string;
  quantity: number;
}

export interface InventoryStock {
  sku: string;
  name: string;
  stockQuantity: number;
  lowStockThreshold: number;
  available: number;
}

interface LockedStock {
  stockQuantity: number;
  lowStockThreshold: number;
}

interface ReservationHeader {
  id: string;
  status: 'active' | 'committed' | 'released' | 'expired';
  expiresAt: string;
}

interface ReservationTransaction {
  expireReservations(merchantId: number, now: string): Promise<void>;
  lockStock(merchantId: number, sku: string): Promise<LockedStock | null>;
  activeQuantity(merchantId: number, sku: string, now: string): Promise<number>;
  findByCheckout(merchantId: number, checkoutId: string): Promise<ReservationHeader | null>;
  reservationLines(reservationId: string): Promise<InventoryLine[]>;
  createReservation(input: {
    id: string;
    merchantId: number;
    checkoutId: string;
    expiresAt: string;
    lines: InventoryLine[];
  }): Promise<void>;
  lockReservation(merchantId: number, reservationId: string): Promise<ReservationHeader | null>;
  ensureStockItem(merchantId: number, sku: string, name: string): Promise<void>;
  updateStock(
    merchantId: number,
    sku: string,
    name: string,
    stockQuantity: number,
    lowStockThreshold: number,
  ): Promise<void>;
  decrementStock(merchantId: number, sku: string, quantity: number): Promise<boolean>;
  updateReservationStatus(
    reservationId: string,
    status: ReservationHeader['status'],
  ): Promise<void>;
}

export interface InventoryReservationStore {
  transaction<T>(work: (tx: ReservationTransaction) => Promise<T>): Promise<T>;
  listStock(merchantId: number, skus: string[] | null, now: string): Promise<InventoryStock[]>;
  expireReservations(merchantId: number, now: string): Promise<void>;
}

export type ReserveResult =
  | { ok: true; reservationId: string; expiresAt: string; available: Record<string, number> }
  | {
      ok: false;
      reason: 'out_of_stock' | 'item_not_found' | 'checkout_expired' | 'checkout_conflict';
      sku?: string;
      available?: number;
    };

function normalizedLines(lines: InventoryLine[]): InventoryLine[] {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) {
    throw new TypeError('items must contain between 1 and 50 inventory lines');
  }

  const quantities = new Map<string, number>();
  for (const line of lines) {
    if (
      !line ||
      typeof line.sku !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(line.sku) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1
    ) {
      throw new TypeError('each inventory line requires a valid SKU and positive integer quantity');
    }
    quantities.set(line.sku, (quantities.get(line.sku) ?? 0) + line.quantity);
  }

  return [...quantities]
    .map(([sku, quantity]) => ({ sku, quantity }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function sameLines(left: InventoryLine[], right: InventoryLine[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (line, index) => line.sku === right[index].sku && line.quantity === right[index].quantity,
    )
  );
}

export class InventoryReservationManager {
  constructor(
    private readonly store: InventoryReservationStore,
    private readonly now: () => number = Date.now,
  ) {}

  async reserve(input: {
    merchantId: number;
    checkoutId: string;
    items: InventoryLine[];
  }): Promise<ReserveResult> {
    if (!Number.isSafeInteger(input.merchantId) || input.merchantId < 1) {
      throw new TypeError('merchantId must be a positive integer');
    }
    if (typeof input.checkoutId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.checkoutId)) {
      throw new TypeError('checkoutId must be a random identifier between 16 and 128 characters');
    }
    const items = normalizedLines(input.items);
    const now = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + INVENTORY_RESERVATION_TTL_MS).toISOString();

    return this.store.transaction(async (tx) => {
      await tx.expireReservations(input.merchantId, now);
      const previous = await tx.findByCheckout(input.merchantId, input.checkoutId);
      if (previous) {
        if (previous.status !== 'active' || new Date(previous.expiresAt).getTime() <= this.now()) {
          if (previous.status === 'active')
            await tx.updateReservationStatus(previous.id, 'expired');
          return { ok: false, reason: 'checkout_expired' };
        }
        const priorLines = await tx.reservationLines(previous.id);
        if (!sameLines(priorLines, items)) return { ok: false, reason: 'checkout_conflict' };
        return {
          ok: true,
          reservationId: previous.id,
          expiresAt: previous.expiresAt,
          available: {},
        };
      }

      const availability: Record<string, number> = {};
      for (const item of items) {
        const stock = await tx.lockStock(input.merchantId, item.sku);
        if (!stock) return { ok: false, reason: 'item_not_found', sku: item.sku };
        const reserved = await tx.activeQuantity(input.merchantId, item.sku, now);
        const available = Math.max(0, stock.stockQuantity - reserved);
        if (available < item.quantity) {
          return { ok: false, reason: 'out_of_stock', sku: item.sku, available };
        }
        availability[item.sku] = available - item.quantity;
      }

      const reservationId = randomUUID();
      await tx.createReservation({
        id: reservationId,
        merchantId: input.merchantId,
        checkoutId: input.checkoutId,
        expiresAt,
        lines: items,
      });
      return { ok: true, reservationId, expiresAt, available: availability };
    });
  }

  async finish(
    merchantId: number,
    reservationId: string,
    action: 'commit' | 'release',
  ): Promise<boolean> {
    if (
      !Number.isSafeInteger(merchantId) ||
      merchantId < 1 ||
      !/^[0-9a-f-]{36}$/i.test(reservationId)
    ) {
      throw new TypeError('invalid reservation identity');
    }

    return this.store.transaction(async (tx) => {
      const reservation = await tx.lockReservation(merchantId, reservationId);
      if (!reservation || reservation.status !== 'active') return false;
      if (action === 'commit' && new Date(reservation.expiresAt).getTime() <= this.now()) {
        await tx.updateReservationStatus(reservationId, 'expired');
        return false;
      }

      if (action === 'commit') {
        for (const item of await tx.reservationLines(reservationId)) {
          if (!(await tx.decrementStock(merchantId, item.sku, item.quantity))) {
            throw new Error('Reserved stock changed before reservation commit');
          }
        }
      }
      await tx.updateReservationStatus(
        reservationId,
        action === 'commit' ? 'committed' : 'released',
      );
      return true;
    });
  }

  async stockLevels(merchantId: number, skus: string[] | null = null): Promise<InventoryStock[]> {
    const now = new Date(this.now()).toISOString();
    await this.store.expireReservations(merchantId, now);
    return this.store.listStock(merchantId, skus, now);
  }

  async setStockLevel(input: {
    merchantId: number;
    sku: string;
    name: string;
    stockQuantity: number;
    lowStockThreshold: number;
  }): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.merchantId) ||
      input.merchantId < 1 ||
      !/^[A-Za-z0-9._:-]{1,100}$/.test(input.sku) ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 160 ||
      !Number.isSafeInteger(input.stockQuantity) ||
      input.stockQuantity < 0 ||
      !Number.isSafeInteger(input.lowStockThreshold) ||
      input.lowStockThreshold < 0
    ) {
      throw new TypeError('invalid inventory stock level');
    }

    return this.store.transaction(async (tx) => {
      await tx.ensureStockItem(input.merchantId, input.sku, input.name.trim());
      await tx.lockStock(input.merchantId, input.sku);
      const reserved = await tx.activeQuantity(
        input.merchantId,
        input.sku,
        new Date(this.now()).toISOString(),
      );
      if (input.stockQuantity < reserved) return false;
      await tx.updateStock(
        input.merchantId,
        input.sku,
        input.name.trim(),
        input.stockQuantity,
        input.lowStockThreshold,
      );
      return true;
    });
  }
}

export class PostgresInventoryReservationStore implements InventoryReservationStore {
  constructor(private readonly client: Client) {}

  async transaction<T>(work: (tx: ReservationTransaction) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await work(new PostgresReservationTransaction(this.client));
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }

  async listStock(
    merchantId: number,
    skus: string[] | null,
    now: string,
  ): Promise<InventoryStock[]> {
    const result = await this.client.query<{
      sku: string;
      name: string;
      stock_quantity: number;
      low_stock_threshold: number;
      available: number;
    }>(
      `SELECT i.sku, i.name, i.stock_quantity, i.low_stock_threshold,
              GREATEST(i.stock_quantity - COALESCE(r.reserved, 0), 0)::int AS available
       FROM inventory_items i
       LEFT JOIN LATERAL (
         SELECT SUM(ri.quantity) AS reserved
         FROM inventory_reservation_items ri
         JOIN inventory_reservations r ON r.id = ri.reservation_id
         WHERE r.merchant_id = i.merchant_id AND ri.sku = i.sku
           AND r.status = 'active' AND r.expires_at > $2
       ) r ON true
       WHERE i.merchant_id = $1 AND ($3::text[] IS NULL OR i.sku = ANY($3))
       ORDER BY i.sku`,
      [merchantId, now, skus],
    );
    return result.rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      stockQuantity: row.stock_quantity,
      lowStockThreshold: row.low_stock_threshold,
      available: row.available,
    }));
  }

  async expireReservations(merchantId: number, now: string): Promise<void> {
    await this.client.query(
      `UPDATE inventory_reservations SET status = 'expired'
       WHERE merchant_id = $1 AND status = 'active' AND expires_at <= $2`,
      [merchantId, now],
    );
  }
}

class PostgresReservationTransaction implements ReservationTransaction {
  constructor(private readonly client: Client) {}

  async lockStock(merchantId: number, sku: string): Promise<LockedStock | null> {
    const result = await this.client.query<{
      stock_quantity: number;
      low_stock_threshold: number;
    }>(
      `SELECT stock_quantity, low_stock_threshold FROM inventory_items
       WHERE merchant_id = $1 AND sku = $2 FOR UPDATE`,
      [merchantId, sku],
    );
    const row = result.rows[0];
    return row
      ? { stockQuantity: row.stock_quantity, lowStockThreshold: row.low_stock_threshold }
      : null;
  }

  async expireReservations(merchantId: number, now: string): Promise<void> {
    await this.client.query(
      `UPDATE inventory_reservations SET status = 'expired'
       WHERE merchant_id = $1 AND status = 'active' AND expires_at <= $2`,
      [merchantId, now],
    );
  }

  async activeQuantity(merchantId: number, sku: string, now: string): Promise<number> {
    const result = await this.client.query<{ reserved: string | number }>(
      `SELECT COALESCE(SUM(ri.quantity), 0)::int AS reserved
       FROM inventory_reservation_items ri
       JOIN inventory_reservations r ON r.id = ri.reservation_id
       WHERE r.merchant_id = $1 AND ri.sku = $2
         AND r.status = 'active' AND r.expires_at > $3`,
      [merchantId, sku, now],
    );
    return Number(result.rows[0]?.reserved ?? 0);
  }

  async findByCheckout(merchantId: number, checkoutId: string): Promise<ReservationHeader | null> {
    const result = await this.client.query<{
      id: string;
      status: ReservationHeader['status'];
      expires_at: Date | string;
    }>(
      `SELECT id, status, expires_at FROM inventory_reservations
       WHERE merchant_id = $1 AND checkout_id = $2 FOR UPDATE`,
      [merchantId, checkoutId],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, status: row.status, expiresAt: new Date(row.expires_at).toISOString() }
      : null;
  }

  async reservationLines(reservationId: string): Promise<InventoryLine[]> {
    const result = await this.client.query<InventoryLine>(
      `SELECT sku, quantity FROM inventory_reservation_items
       WHERE reservation_id = $1 ORDER BY sku`,
      [reservationId],
    );
    return result.rows;
  }

  async createReservation(input: {
    id: string;
    merchantId: number;
    checkoutId: string;
    expiresAt: string;
    lines: InventoryLine[];
  }): Promise<void> {
    await this.client.query(
      `INSERT INTO inventory_reservations (id, merchant_id, checkout_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.id, input.merchantId, input.checkoutId, input.expiresAt],
    );
    for (const line of input.lines) {
      await this.client.query(
        `INSERT INTO inventory_reservation_items (reservation_id, merchant_id, sku, quantity)
         VALUES ($1, $2, $3, $4)`,
        [input.id, input.merchantId, line.sku, line.quantity],
      );
    }
  }

  async lockReservation(
    merchantId: number,
    reservationId: string,
  ): Promise<ReservationHeader | null> {
    const result = await this.client.query<{
      id: string;
      status: ReservationHeader['status'];
      expires_at: Date | string;
    }>(
      `SELECT id, status, expires_at FROM inventory_reservations
       WHERE merchant_id = $1 AND id = $2 FOR UPDATE`,
      [merchantId, reservationId],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, status: row.status, expiresAt: new Date(row.expires_at).toISOString() }
      : null;
  }

  async ensureStockItem(merchantId: number, sku: string, name: string): Promise<void> {
    await this.client.query(
      `INSERT INTO inventory_items (merchant_id, sku, name, stock_quantity)
       VALUES ($1, $2, $3, 0) ON CONFLICT (merchant_id, sku) DO NOTHING`,
      [merchantId, sku, name],
    );
  }

  async updateStock(
    merchantId: number,
    sku: string,
    name: string,
    stockQuantity: number,
    lowStockThreshold: number,
  ): Promise<void> {
    await this.client.query(
      `UPDATE inventory_items SET name = $3, stock_quantity = $4,
         low_stock_threshold = $5, updated_at = now()
       WHERE merchant_id = $1 AND sku = $2`,
      [merchantId, sku, name, stockQuantity, lowStockThreshold],
    );
  }

  async decrementStock(merchantId: number, sku: string, quantity: number): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE inventory_items SET stock_quantity = stock_quantity - $3, updated_at = now()
       WHERE merchant_id = $1 AND sku = $2 AND stock_quantity >= $3`,
      [merchantId, sku, quantity],
    );
    return result.rowCount === 1;
  }

  async updateReservationStatus(
    reservationId: string,
    status: ReservationHeader['status'],
  ): Promise<void> {
    await this.client.query(`UPDATE inventory_reservations SET status = $2 WHERE id = $1`, [
      reservationId,
      status,
    ]);
  }
}
