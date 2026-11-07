import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import {
  forecasts,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockLevels,
  stockMovements,
  suppliers,
  users,
  warehouses,
} from '../../db/schema';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { generateEan13 } from '../../utils/barcode';
import { notFound } from '../../utils/httpError';

export const productsRouter = Router();

const ListQuery = z.object({
  q: z.string().trim().optional(),
  category: z.string().optional(),
  supplierId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  status: z.enum(['ok', 'low', 'out']).optional(),
  sort: z.enum(['name', 'sku', 'quantity', 'value', 'cover']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Product list with stock aggregated across warehouses (or for one warehouse),
 * stock status, value and forecast cover — all computed in a single SQL query.
 */
productsRouter.get('/', validate({ query: ListQuery }), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof ListQuery>;

  const stockAgg = db
    .select({
      productId: stockLevels.productId,
      qty: sql<number>`sum(${stockLevels.quantity})`.as('qty'),
      rop: sql<number>`sum(${stockLevels.reorderPoint})`.as('rop'),
      lowCount: sql<number>`count(*) filter (where ${stockLevels.quantity} <= ${stockLevels.reorderPoint})`.as(
        'low_count',
      ),
      whCount: sql<number>`count(*)`.as('wh_count'),
    })
    .from(stockLevels)
    .where(q.warehouseId ? eq(stockLevels.warehouseId, q.warehouseId) : undefined)
    .groupBy(stockLevels.productId)
    .as('s');

  const fcAgg = db
    .select({
      productId: forecasts.productId,
      demand: sql<number>`sum(${forecasts.avgDailyDemand})`.as('demand'),
      recommended: sql<number>`sum(${forecasts.recommendedOrderQty})`.as('recommended'),
    })
    .from(forecasts)
    .where(q.warehouseId ? eq(forecasts.warehouseId, q.warehouseId) : undefined)
    .groupBy(forecasts.productId)
    .as('f');

  const qty = sql<number>`coalesce(${stockAgg.qty}, 0)`;
  const rop = sql<number>`coalesce(${stockAgg.rop}, 0)`;
  // "low" if ANY warehouse is at or below its reorder point — a healthy total can hide a local shortage.
  const status = sql<
    'ok' | 'low' | 'out'
  >`case when ${qty} = 0 then 'out' when coalesce(${stockAgg.lowCount}, 0) > 0 then 'low' else 'ok' end`;
  const value = sql<number>`${qty} * ${products.costPrice}`;
  const cover = sql<number | null>`case when coalesce(${fcAgg.demand}, 0) > 0 then ${qty} / ${fcAgg.demand} end`;

  const filters: (SQL | undefined)[] = [eq(products.isActive, true)];
  if (q.q) {
    const term = `%${q.q}%`;
    filters.push(or(ilike(products.name, term), ilike(products.sku, term), ilike(products.barcode, term)));
  }
  if (q.category) filters.push(eq(products.category, q.category));
  if (q.supplierId) filters.push(eq(products.supplierId, q.supplierId));
  if (q.status) filters.push(sql`${status} = ${q.status}`);
  const where = and(...filters);

  const sortCol = { name: products.name, sku: products.sku, quantity: qty, value, cover }[q.sort];
  const order = q.dir === 'desc' ? sql`${sortCol} desc nulls last` : sql`${sortCol} asc nulls last`;

  const base = db
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      category: products.category,
      unit: products.unit,
      costPrice: products.costPrice,
      sellPrice: products.sellPrice,
      supplierId: products.supplierId,
      supplierName: suppliers.name,
      quantity: qty.mapWith(Number),
      reorderPoint: rop.mapWith(Number),
      status,
      lowWarehouses: sql<number>`coalesce(${stockAgg.lowCount}, 0)`.mapWith(Number),
      warehouseCount: sql<number>`coalesce(${stockAgg.whCount}, 0)`.mapWith(Number),
      stockValue: value.mapWith(Number),
      avgDailyDemand: sql<number>`coalesce(${fcAgg.demand}, 0)`.mapWith(Number),
      daysOfCover: cover.mapWith((v) => (v == null ? null : Number(v))),
      recommendedOrderQty: sql<number>`coalesce(${fcAgg.recommended}, 0)`.mapWith(Number),
    })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .leftJoin(stockAgg, eq(stockAgg.productId, products.id))
    .leftJoin(fcAgg, eq(fcAgg.productId, products.id))
    .where(where);

  const [items, [{ total }], statusCounts] = await Promise.all([
    base
      .orderBy(order, asc(products.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(products)
      .leftJoin(stockAgg, eq(stockAgg.productId, products.id))
      .where(where),
    db
      .select({ status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(products)
      .leftJoin(stockAgg, eq(stockAgg.productId, products.id))
      .where(and(...filters.slice(0, q.status ? -1 : undefined)))
      .groupBy(status),
  ]);

  res.json({
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s.n])),
  });
});

productsRouter.get('/categories', async (_req, res) => {
  const rows = await db.selectDistinct({ category: products.category }).from(products).orderBy(asc(products.category));
  res.json(rows.map((r) => r.category));
});

/** Exact lookup by barcode or SKU — used by the camera scanner. */
productsRouter.get('/lookup', validate({ query: z.object({ code: z.string().trim().min(1) }) }), async (_req, res) => {
  const { code } = res.locals.query as { code: string };
  const [p] = await db
    .select({ id: products.id, sku: products.sku, name: products.name, barcode: products.barcode })
    .from(products)
    .where(or(eq(products.barcode, code), eq(sql`upper(${products.sku})`, code.toUpperCase())));
  if (!p) throw notFound(`Product with code ${code}`);
  res.json(p);
});

productsRouter.get('/:id', async (req, res) => {
  const id = req.params.id as string;
  const [product] = await db
    .select({ product: products, supplier: suppliers })
    .from(products)
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(eq(products.id, id));
  if (!product) throw notFound('Product');

  const [byWarehouse, onOrder] = await Promise.all([
    db
      .select({
        warehouseId: warehouses.id,
        warehouseName: warehouses.name,
        warehouseCode: warehouses.code,
        quantity: sql<number>`coalesce(${stockLevels.quantity}, 0)`.mapWith(Number),
        reorderPoint: sql<number>`coalesce(${stockLevels.reorderPoint}, 0)`.mapWith(Number),
        safetyStock: sql<number>`coalesce(${stockLevels.safetyStock}, 0)`.mapWith(Number),
        forecast: {
          avgDailyDemand: forecasts.avgDailyDemand,
          demandStdDev: forecasts.demandStdDev,
          leadTimeDays: forecasts.leadTimeDays,
          recommendedOrderQty: forecasts.recommendedOrderQty,
          daysOfCover: forecasts.daysOfCover,
          stockoutDate: forecasts.stockoutDate,
          excessQty: forecasts.excessQty,
          mape: forecasts.mape,
          model: forecasts.model,
          generatedAt: forecasts.generatedAt,
        },
      })
      .from(warehouses)
      .leftJoin(stockLevels, and(eq(stockLevels.warehouseId, warehouses.id), eq(stockLevels.productId, id)))
      .leftJoin(forecasts, and(eq(forecasts.warehouseId, warehouses.id), eq(forecasts.productId, id)))
      .orderBy(asc(warehouses.name)),
    db
      .select({
        poId: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        warehouseId: purchaseOrders.warehouseId,
        quantity: purchaseOrderItems.quantity,
        expectedDate: purchaseOrders.expectedDate,
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
      .where(
        and(eq(purchaseOrderItems.productId, id), sql`${purchaseOrders.status} in ('DRAFT','SUBMITTED','APPROVED')`),
      ),
  ]);

  res.json({
    ...product.product,
    supplier: product.supplier,
    stock: byWarehouse.map((w) => ({ ...w, forecast: w.forecast?.model ? w.forecast : null })),
    openOrders: onOrder,
  });
});

/** Daily sales history + forecast for the product chart. */
productsRouter.get(
  '/:id/history',
  validate({
    query: z.object({ warehouseId: z.uuid().optional(), days: z.coerce.number().int().min(14).max(365).default(90) }),
  }),
  async (req, res) => {
    const id = req.params.id as string;
    const { warehouseId, days } = res.locals.query as { warehouseId?: string; days: number };
    const whFilter = warehouseId ? sql`and m.warehouse_id = ${warehouseId}` : sql``;

    // generate_series fills days with zero sales so the chart has no gaps.
    const history = await db.execute<{ date: string; qty: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as date, coalesce(sum(-m.quantity), 0)::int as qty
      from generate_series(current_date - ${days - 1}::int, current_date, interval '1 day') as d(day)
      left join stock_movements m
        on m.product_id = ${id} and m.type = 'SALE' and m.created_at::date = d.day::date ${whFilter}
      group by d.day order by d.day`);

    const fc = await db
      .select({ series: forecasts.series, warehouseId: forecasts.warehouseId })
      .from(forecasts)
      .where(and(eq(forecasts.productId, id), warehouseId ? eq(forecasts.warehouseId, warehouseId) : undefined));

    // Sum forecasts across warehouses when no warehouse is selected.
    const merged = new Map<string, { date: string; qty: number; lower: number; upper: number }>();
    for (const f of fc) {
      for (const p of f.series) {
        const cur = merged.get(p.date) ?? { date: p.date, qty: 0, lower: 0, upper: 0 };
        cur.qty += p.qty;
        cur.lower += p.lower;
        cur.upper += p.upper;
        merged.set(p.date, cur);
      }
    }
    const round = (n: number) => Math.round(n * 10) / 10;
    res.json({
      history: history.rows.map((r) => ({ date: r.date, qty: Number(r.qty) })),
      forecast: [...merged.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => ({ date: p.date, qty: round(p.qty), lower: round(p.lower), upper: round(p.upper) })),
    });
  },
);

productsRouter.get('/:id/movements', async (req, res) => {
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      reference: stockMovements.reference,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      warehouseName: warehouses.name,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(and(eq(stockMovements.productId, req.params.id as string), sql`${stockMovements.userId} is not null`))
    .orderBy(desc(stockMovements.createdAt))
    .limit(25);
  res.json(rows);
});

const ProductBody = z.object({
  sku: z.string().trim().toUpperCase().min(3).max(32),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'Barcode must be 8–14 digits')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  name: z.string().trim().min(2),
  category: z.string().trim().min(2),
  unit: z.string().trim().default('pcs'),
  costPrice: z.coerce.number().positive(),
  sellPrice: z.coerce.number().positive(),
  supplierId: z.uuid().optional().nullable(),
});

productsRouter.post('/', authorize(...can.manageCatalog), validate({ body: ProductBody }), async (req, res) => {
  const body = req.body as z.infer<typeof ProductBody>;
  const [p] = await db
    .insert(products)
    .values({ ...body, barcode: body.barcode ?? generateEan13() })
    .returning();
  // Create an empty stock row in every warehouse so it shows up everywhere.
  const whs = await db.select({ id: warehouses.id }).from(warehouses);
  if (whs.length) {
    await db
      .insert(stockLevels)
      .values(whs.map((w) => ({ productId: p.id, warehouseId: w.id })))
      .onConflictDoNothing();
  }
  res.status(201).json(p);
});

productsRouter.patch(
  '/:id',
  authorize(...can.manageCatalog),
  validate({ body: ProductBody.partial() }),
  async (req, res) => {
    const [p] = await db
      .update(products)
      .set(req.body)
      .where(eq(products.id, req.params.id as string))
      .returning();
    if (!p) throw notFound('Product');
    res.json(p);
  },
);

/** Soft delete: history and purchase orders keep referring to the product. */
productsRouter.delete('/:id', authorize(...can.manageCatalog), async (req, res) => {
  const [p] = await db
    .update(products)
    .set({ isActive: false })
    .where(eq(products.id, req.params.id as string))
    .returning({ id: products.id });
  if (!p) throw notFound('Product');
  res.status(204).end();
});
