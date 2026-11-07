import { and, desc, eq, isNull } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client';
import { alerts, products, warehouses } from '../../db/schema';
import { emit } from '../../lib/socket';
import { notFound } from '../../utils/httpError';

export const alertsRouter = Router();

alertsRouter.get('/', async (_req, res) => {
  const rows = await db
    .select({
      id: alerts.id,
      type: alerts.type,
      message: alerts.message,
      createdAt: alerts.createdAt,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      warehouseId: warehouses.id,
      warehouseName: warehouses.name,
    })
    .from(alerts)
    .innerJoin(products, eq(products.id, alerts.productId))
    .innerJoin(warehouses, eq(warehouses.id, alerts.warehouseId))
    .where(isNull(alerts.resolvedAt))
    .orderBy(desc(alerts.createdAt))
    .limit(100);
  res.json(rows);
});

/** Dismiss an alert manually (it re-opens automatically if stock drops again later). */
alertsRouter.post('/:id/dismiss', async (req, res) => {
  const [a] = await db
    .update(alerts)
    .set({ resolvedAt: new Date() })
    .where(and(eq(alerts.id, req.params.id as string), isNull(alerts.resolvedAt)))
    .returning({ id: alerts.id });
  if (!a) throw notFound('Open alert');
  emit('alert:resolved', [a.id]);
  res.status(204).end();
});
