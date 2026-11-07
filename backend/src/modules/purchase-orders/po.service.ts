import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import {
  forecasts,
  poNumberSeq,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  type POStatus,
} from '../../db/schema';
import type { AuthUser } from '../../middleware/auth';
import { can } from '../../middleware/auth';
import { invalidate } from '../../lib/cache';
import { emit } from '../../lib/socket';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError';
import { refreshPairs } from '../forecasts/forecast.service';
import { afterStockChange, applyMovement } from '../stock/stock.service';

/**
 * Purchase order lifecycle as an explicit state machine.
 * Any transition not listed here is rejected with 409 Conflict.
 */
export const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export function assertTransition(from: POStatus, to: POStatus) {
  if (!PO_TRANSITIONS[from].includes(to)) {
    throw conflict(`A ${from.toLowerCase()} order cannot be moved to ${to.toLowerCase()}`);
  }
}

export interface POItemInput {
  productId: string;
  quantity: number;
  unitCost?: number;
}

async function nextPoNumber() {
  const { rows } = await db.execute<{ n: string }>(sql`select nextval(${poNumberSeq.seqName}) as n`);
  const n = rows[0].n;
  return `PO-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
}

async function resolveItems(items: POItemInput[]) {
  if (!items.length) throw badRequest('Add at least one item');
  const ids = [...new Set(items.map((i) => i.productId))];
  if (ids.length !== items.length) throw badRequest('Each product can appear only once per order');
  const rows = await db
    .select({ id: products.id, costPrice: products.costPrice })
    .from(products)
    .where(inArray(products.id, ids));
  if (rows.length !== ids.length) throw notFound('One or more products');
  const cost = new Map(rows.map((r) => [r.id, r.costPrice]));
  return items.map((i) => ({ ...i, unitCost: i.unitCost ?? cost.get(i.productId)! }));
}

const total = (items: { quantity: number; unitCost: number }[]) =>
  Math.round(items.reduce((s, i) => s + i.quantity * i.unitCost, 0) * 100) / 100;

export async function createPurchaseOrder(input: {
  supplierId: string;
  warehouseId: string;
  expectedDate?: Date | null;
  notes?: string | null;
  items: POItemInput[];
  userId: string;
}) {
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, input.supplierId));
  if (!supplier) throw notFound('Supplier');
  const items = await resolveItems(input.items);
  const poNumber = await nextPoNumber();
  const expectedDate = input.expectedDate ?? new Date(Date.now() + supplier.leadTimeDays * 86_400_000);

  const po = await db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        poNumber,
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        expectedDate,
        notes: input.notes ?? null,
        totalAmount: total(items),
        createdById: input.userId,
      })
      .returning();
    await tx.insert(purchaseOrderItems).values(items.map((i) => ({ ...i, purchaseOrderId: po.id })));
    return po;
  });
  await afterPoChange(po.id);
  return po;
}

export async function updateDraft(
  id: string,
  input: { expectedDate?: Date | null; notes?: string | null; items?: POItemInput[] },
) {
  const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
  if (!po) throw notFound('Purchase order');
  if (po.status !== 'DRAFT') throw conflict('Only draft orders can be edited');
  await db.transaction(async (tx) => {
    const patch: Partial<typeof purchaseOrders.$inferInsert> = {};
    if (input.expectedDate !== undefined) patch.expectedDate = input.expectedDate;
    if (input.notes !== undefined) patch.notes = input.notes;
    if (input.items) {
      const items = await resolveItems(input.items);
      await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
      await tx.insert(purchaseOrderItems).values(items.map((i) => ({ ...i, purchaseOrderId: id })));
      patch.totalAmount = total(items);
    }
    if (Object.keys(patch).length) await tx.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id));
  });
  await afterPoChange(id);
}

/** Moves an order to a new status, enforcing the state machine and role rules. */
export async function transition(id: string, to: POStatus, user: AuthUser) {
  const needs: Partial<Record<POStatus, typeof can.createPO>> = {
    SUBMITTED: can.createPO,
    APPROVED: can.approvePO,
    DRAFT: can.approvePO, // "send back for changes"
    RECEIVED: can.receivePO,
    CANCELLED: can.createPO,
  };
  if (!needs[to]?.includes(user.role)) throw forbidden();

  const touched = await db.transaction(async (tx) => {
    // Lock the order so two people can't receive it twice at the same moment.
    const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for('update');
    if (!po) throw notFound('Purchase order');
    assertTransition(po.status, to);
    if (to === 'CANCELLED' && po.status === 'APPROVED' && !can.approvePO.includes(user.role)) throw forbidden();

    const now = new Date();
    const patch: Partial<typeof purchaseOrders.$inferInsert> = { status: to };
    if (to === 'SUBMITTED') patch.submittedAt = now;
    if (to === 'APPROVED') Object.assign(patch, { approvedAt: now, approvedById: user.id });
    if (to === 'DRAFT') Object.assign(patch, { submittedAt: null });

    const pairs: { productId: string; warehouseId: string }[] = [];
    if (to === 'RECEIVED') {
      patch.receivedAt = now;
      const items = await tx.select().from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
      for (const item of items) {
        await applyMovement(tx, {
          productId: item.productId,
          warehouseId: po.warehouseId,
          type: 'RECEIPT',
          delta: item.quantity,
          reference: po.poNumber,
          note: 'Received against purchase order',
          userId: user.id,
        });
        pairs.push({ productId: item.productId, warehouseId: po.warehouseId });
      }
    }
    await tx.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id));
    return pairs;
  });

  if (touched.length) await afterStockChange(touched);
  await afterPoChange(id);
}

/**
 * Turns forecast recommendations into draft purchase orders — one per supplier —
 * for a warehouse. This is the "one click replenishment" feature.
 */
export async function createFromRecommendations(input: { warehouseId: string; productIds?: string[]; userId: string }) {
  const recs = await db
    .select({
      productId: forecasts.productId,
      qty: forecasts.recommendedOrderQty,
      supplierId: products.supplierId,
      costPrice: products.costPrice,
    })
    .from(forecasts)
    .innerJoin(products, eq(products.id, forecasts.productId))
    .where(
      and(
        eq(forecasts.warehouseId, input.warehouseId),
        gt(forecasts.recommendedOrderQty, 0),
        eq(products.isActive, true),
        input.productIds?.length ? inArray(forecasts.productId, input.productIds) : undefined,
      ),
    );

  const bySupplier = new Map<string, POItemInput[]>();
  for (const r of recs) {
    if (!r.supplierId) continue;
    const list = bySupplier.get(r.supplierId) ?? [];
    list.push({ productId: r.productId, quantity: r.qty, unitCost: r.costPrice });
    bySupplier.set(r.supplierId, list);
  }
  if (!bySupplier.size) throw badRequest('Nothing needs reordering for this warehouse right now');

  const created = [];
  for (const [supplierId, items] of bySupplier) {
    created.push(
      await createPurchaseOrder({
        supplierId,
        warehouseId: input.warehouseId,
        items,
        notes: 'Generated from StockSense demand forecast',
        userId: input.userId,
      }),
    );
  }
  return created;
}

async function afterPoChange(id: string) {
  await invalidate('dashboard:');
  emit('po:changed', { id });
  // Submitting, approving or cancelling changes "on order", which changes what to reorder.
  const [po] = await db
    .select({ warehouseId: purchaseOrders.warehouseId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id));
  if (!po) return;
  const items = await db
    .select({ productId: purchaseOrderItems.productId })
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, id));
  void refreshPairs(items.map((i) => ({ productId: i.productId, warehouseId: po.warehouseId })));
}
