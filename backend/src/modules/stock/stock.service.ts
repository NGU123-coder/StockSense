import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Tx } from '../../db/client';
import { alerts, products, stockLevels, stockMovements, warehouses, type MovementType } from '../../db/schema';
import { invalidate } from '../../lib/cache';
import { emit } from '../../lib/socket';
import { enqueueAlertEmail } from '../../jobs/queues';
import { badRequest, conflict, notFound } from '../../utils/httpError';

export interface MovementInput {
  productId: string;
  warehouseId: string;
  type: MovementType;
  /** Signed: positive adds stock, negative removes it. */
  delta: number;
  reference?: string | null;
  note?: string | null;
  userId?: string | null;
}

/**
 * Applies one stock change inside an existing transaction.
 *
 * Concurrency: the stock_levels row is locked with SELECT ... FOR UPDATE, so if two
 * cashiers sell the last unit at the same moment, the second transaction waits for
 * the first and then sees the real quantity. A CHECK constraint (quantity >= 0)
 * backs this up at the database level.
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw badRequest('Quantity must be a non-zero whole number');
  }

  // Make sure the row exists (first receipt of a product into a warehouse).
  await tx
    .insert(stockLevels)
    .values({ productId: input.productId, warehouseId: input.warehouseId, quantity: 0 })
    .onConflictDoNothing({ target: [stockLevels.productId, stockLevels.warehouseId] });

  const [level] = await tx
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.productId, input.productId), eq(stockLevels.warehouseId, input.warehouseId)))
    .for('update');

  const newQty = level.quantity + input.delta;
  if (newQty < 0) {
    throw conflict(`Not enough stock: ${level.quantity} available, ${-input.delta} requested`, {
      available: level.quantity,
    });
  }

  await tx.update(stockLevels).set({ quantity: newQty }).where(eq(stockLevels.id, level.id));

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      productId: input.productId,
      warehouseId: input.warehouseId,
      type: input.type,
      quantity: input.delta,
      reference: input.reference ?? null,
      note: input.note ?? null,
      userId: input.userId ?? null,
    })
    .returning();

  return { movement, previousQty: level.quantity, newQty, reorderPoint: level.reorderPoint };
}

async function assertExists(productId: string, warehouseId: string) {
  const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId));
  if (!p) throw notFound('Product');
  const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!w) throw notFound('Warehouse');
}

/** Records a receipt, sale or adjustment and then re-evaluates alerts. */
export async function recordMovement(input: {
  productId: string;
  warehouseId: string;
  type: 'RECEIPT' | 'SALE' | 'ADJUSTMENT';
  quantity: number;
  note?: string;
  reference?: string;
  userId: string;
}) {
  await assertExists(input.productId, input.warehouseId);
  // Receipts add, sales remove, adjustments carry their own sign (e.g. -3 damaged).
  const delta =
    input.type === 'RECEIPT'
      ? Math.abs(input.quantity)
      : input.type === 'SALE'
        ? -Math.abs(input.quantity)
        : input.quantity;

  const result = await db.transaction((tx) => applyMovement(tx, { ...input, delta, type: input.type }));
  await afterStockChange([{ productId: input.productId, warehouseId: input.warehouseId }]);
  return result;
}

/** Moves stock between two warehouses atomically: both legs succeed or neither does. */
export async function transferStock(input: {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  note?: string;
  userId: string;
}) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw badRequest('Source and destination warehouse must be different');
  }
  await assertExists(input.productId, input.fromWarehouseId);
  await assertExists(input.productId, input.toWarehouseId);
  const reference = `TRF-${Date.now().toString(36).toUpperCase()}`;

  const result = await db.transaction(async (tx) => {
    // Lock rows in a consistent order (by id) to avoid deadlocks between opposite transfers.
    const legs = [
      { warehouseId: input.fromWarehouseId, type: 'TRANSFER_OUT' as const, delta: -input.quantity },
      { warehouseId: input.toWarehouseId, type: 'TRANSFER_IN' as const, delta: input.quantity },
    ].sort((a, b) => a.warehouseId.localeCompare(b.warehouseId));
    const out = [];
    for (const leg of legs) {
      out.push(
        await applyMovement(tx, {
          productId: input.productId,
          warehouseId: leg.warehouseId,
          type: leg.type,
          delta: leg.delta,
          reference,
          note: input.note,
          userId: input.userId,
        }),
      );
    }
    return { reference, legs: out };
  });

  await afterStockChange([
    { productId: input.productId, warehouseId: input.fromWarehouseId },
    { productId: input.productId, warehouseId: input.toWarehouseId },
  ]);
  return result;
}

/** Post-commit side effects: alerts, cache invalidation and live updates. */
export async function afterStockChange(pairs: { productId: string; warehouseId: string }[]) {
  for (const pair of pairs) await evaluateAlert(pair.productId, pair.warehouseId);
  await invalidate('dashboard:');
  emit('stock:changed', pairs);
  // Lazy import avoids a circular dependency (forecast.service imports this module).
  void import('../forecasts/forecast.service').then((m) => m.refreshPairs(pairs));
}

/**
 * Opens a LOW_STOCK / OUT_OF_STOCK alert when stock falls to or below the reorder
 * point, and resolves open alerts once stock is healthy again. Never duplicates.
 */
export async function evaluateAlert(productId: string, warehouseId: string) {
  const [row] = await db
    .select({
      quantity: stockLevels.quantity,
      reorderPoint: stockLevels.reorderPoint,
      productName: products.name,
      sku: products.sku,
      warehouseName: warehouses.name,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
    .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
  if (!row) return;

  const wanted = row.quantity === 0 ? 'OUT_OF_STOCK' : row.quantity <= row.reorderPoint ? 'LOW_STOCK' : null;

  const open = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.productId, productId), eq(alerts.warehouseId, warehouseId), isNull(alerts.resolvedAt)));

  // Resolve alerts that no longer apply (stock recovered, or LOW became OUT).
  const stale = open.filter((a) => a.type !== wanted);
  if (stale.length) {
    await db
      .update(alerts)
      .set({ resolvedAt: new Date() })
      .where(sql`${alerts.id} in ${stale.map((a) => a.id)}`);
    emit(
      'alert:resolved',
      stale.map((a) => a.id),
    );
  }

  if (wanted && !open.some((a) => a.type === wanted)) {
    const message =
      wanted === 'OUT_OF_STOCK'
        ? `${row.productName} (${row.sku}) is out of stock at ${row.warehouseName}`
        : `${row.productName} (${row.sku}) is low at ${row.warehouseName}: ${row.quantity} left, reorder point ${row.reorderPoint}`;
    const [alert] = await db.insert(alerts).values({ type: wanted, productId, warehouseId, message }).returning();
    emit('alert:new', { ...alert, productName: row.productName, sku: row.sku, warehouseName: row.warehouseName });
    await enqueueAlertEmail({ subject: `[StockSense] ${wanted.replace('_', ' ')}: ${row.productName}`, text: message });
  }
}
