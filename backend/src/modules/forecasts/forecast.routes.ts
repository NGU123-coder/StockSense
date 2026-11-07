import { and, eq, gt, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { forecasts, products, suppliers, warehouses } from '../../db/schema';
import { forecastServiceHealthy } from '../../lib/forecastClient';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { enqueueForecastRun } from '../../jobs/queues';
import { forecastRunState, lastForecastTime, runForecasts } from './forecast.service';

export const forecastRouter = Router();

const RecQuery = z.object({
  warehouseId: z.uuid().optional(),
  view: z.enum(['reorder', 'excess', 'all']).default('reorder'),
});

/**
 * Reorder planner: what to buy, how much, and what it costs — plus overstock.
 * "Revenue at risk" = units we expect to miss selling because stock runs out
 * before a new order could arrive (days of cover < supplier lead time).
 */
forecastRouter.get('/recommendations', validate({ query: RecQuery }), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof RecQuery>;
  const shortfallDays = sql`greatest(${forecasts.leadTimeDays} - coalesce(${forecasts.daysOfCover}, 0), 0)`;
  const revenueAtRisk = sql<number>`case when ${forecasts.daysOfCover} < ${forecasts.leadTimeDays}
    then ${forecasts.avgDailyDemand} * ${shortfallDays} * ${products.sellPrice} else 0 end`;

  const filters: (SQL | undefined)[] = [
    eq(products.isActive, true),
    q.warehouseId ? eq(forecasts.warehouseId, q.warehouseId) : undefined,
    q.view === 'reorder' ? gt(forecasts.recommendedOrderQty, 0) : undefined,
    q.view === 'excess' ? gt(forecasts.excessQty, 0) : undefined,
  ];

  const rows = await db
    .select({
      productId: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      unit: products.unit,
      costPrice: products.costPrice,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      warehouseId: warehouses.id,
      warehouseName: warehouses.name,
      warehouseCode: warehouses.code,
      onHand: forecasts.onHand,
      onOrder: forecasts.onOrder,
      reorderPoint: forecasts.reorderPoint,
      safetyStock: forecasts.safetyStock,
      avgDailyDemand: forecasts.avgDailyDemand,
      leadTimeDays: forecasts.leadTimeDays,
      daysOfCover: forecasts.daysOfCover,
      stockoutDate: forecasts.stockoutDate,
      recommendedOrderQty: forecasts.recommendedOrderQty,
      orderValue: sql<number>`${forecasts.recommendedOrderQty} * ${products.costPrice}`.mapWith(Number),
      excessQty: forecasts.excessQty,
      excessValue: sql<number>`${forecasts.excessQty} * ${products.costPrice}`.mapWith(Number),
      revenueAtRisk: revenueAtRisk.mapWith(Number),
      mape: forecasts.mape,
      model: forecasts.model,
    })
    .from(forecasts)
    .innerJoin(products, eq(products.id, forecasts.productId))
    .innerJoin(warehouses, eq(warehouses.id, forecasts.warehouseId))
    .leftJoin(suppliers, eq(suppliers.id, products.supplierId))
    .where(and(...filters))
    .orderBy(
      q.view === 'excess'
        ? sql`${forecasts.excessQty} * ${products.costPrice} desc`
        : sql`${forecasts.daysOfCover} asc nulls first`,
    );

  const summary = rows.reduce(
    (s, r) => ({
      items: s.items + (r.recommendedOrderQty > 0 ? 1 : 0),
      orderValue: s.orderValue + r.orderValue,
      excessValue: s.excessValue + r.excessValue,
      revenueAtRisk: s.revenueAtRisk + r.revenueAtRisk,
    }),
    { items: 0, orderValue: 0, excessValue: 0, revenueAtRisk: 0 },
  );

  res.json({ items: rows, summary });
});

forecastRouter.get('/status', async (_req, res) => {
  const [healthy, lastRunAt, accuracy] = await Promise.all([
    forecastServiceHealthy(),
    lastForecastTime(),
    db
      .select({
        avgMape: sql<number | null>`avg(${forecasts.mape}) filter (where ${forecasts.mape} is not null)`.mapWith((v) =>
          v == null ? null : Number(v),
        ),
        series: sql<number>`count(*)`.mapWith(Number),
      })
      .from(forecasts),
  ]);
  const state = forecastRunState();
  res.json({ ...state, lastRunAt: state.lastRunAt ?? lastRunAt, serviceHealthy: healthy, ...accuracy[0] });
});

/** Starts a forecast run. Queued via BullMQ when available (202), else runs inline (200). */
forecastRouter.post('/run', authorize(...can.runForecast), async (_req, res) => {
  const jobId = await enqueueForecastRun();
  if (jobId) {
    res.status(202).json({ queued: true, jobId });
    return;
  }
  res.json({ queued: false, ...(await runForecasts()) });
});
