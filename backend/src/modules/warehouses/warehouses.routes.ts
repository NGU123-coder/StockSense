import { asc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { products, stockLevels, warehouses } from '../../db/schema';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notFound } from '../../utils/httpError';

export const warehousesRouter = Router();

/** Warehouses with live totals: SKUs stocked, units, stock value and low-stock count. */
warehousesRouter.get('/', async (_req, res) => {
  const rows = await db
    .select({
      id: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
      city: warehouses.city,
      address: warehouses.address,
      skuCount: sql<number>`count(${stockLevels.id}) filter (where ${stockLevels.quantity} > 0)`.mapWith(Number),
      totalUnits: sql<number>`coalesce(sum(${stockLevels.quantity}), 0)`.mapWith(Number),
      stockValue: sql<number>`coalesce(sum(${stockLevels.quantity} * ${products.costPrice}), 0)`.mapWith(Number),
      lowStockCount:
        sql<number>`count(${stockLevels.id}) filter (where ${stockLevels.quantity} <= ${stockLevels.reorderPoint})`.mapWith(
          Number,
        ),
    })
    .from(warehouses)
    .leftJoin(stockLevels, eq(stockLevels.warehouseId, warehouses.id))
    .leftJoin(products, eq(products.id, stockLevels.productId))
    .groupBy(warehouses.id)
    .orderBy(asc(warehouses.name));
  res.json(rows);
});

const WarehouseBody = z.object({
  code: z.string().trim().toUpperCase().min(2).max(10),
  name: z.string().trim().min(2),
  city: z.string().trim().min(2),
  address: z.string().trim().optional().nullable(),
});

warehousesRouter.post('/', authorize(...can.manageCatalog), validate({ body: WarehouseBody }), async (req, res) => {
  const [w] = await db.insert(warehouses).values(req.body).returning();
  res.status(201).json(w);
});

warehousesRouter.patch(
  '/:id',
  authorize(...can.manageCatalog),
  validate({ body: WarehouseBody.partial() }),
  async (req, res) => {
    const [w] = await db
      .update(warehouses)
      .set(req.body)
      .where(eq(warehouses.id, req.params.id as string))
      .returning();
    if (!w) throw notFound('Warehouse');
    res.json(w);
  },
);
