import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { forecasts, stockLevels } from '../../db/schema';
import { invalidate } from '../../lib/cache';
import { env } from '../../config/env';
import { callForecastService, type ForecastResult } from '../../lib/forecastClient';
import { emit } from '../../lib/socket';
import { evaluateAlert } from '../stock/stock.service';

const POLICY = { horizon_days: 30, service_level: 0.95, cover_days: 14 };

/** Stores forecasts and copies the new reorder point / safety stock onto each stock level, in one transaction. */
async function persist(results: ForecastResult[], generatedAtIso: string) {
  const generatedAt = new Date(generatedAtIso);
  await db.transaction(async (tx) => {
    for (const r of results) {
      const values = {
        productId: r.product_id,
        warehouseId: r.warehouse_id,
        model: r.model,
        avgDailyDemand: r.avg_daily_demand,
        demandStdDev: r.demand_std_dev,
        leadTimeDays: r.lead_time_days,
        safetyStock: r.safety_stock,
        reorderPoint: r.reorder_point,
        recommendedOrderQty: r.recommended_order_qty,
        onHand: r.on_hand,
        onOrder: r.on_order,
        daysOfCover: r.days_of_cover,
        stockoutDate: r.stockout_date ? new Date(r.stockout_date) : null,
        excessQty: r.excess_qty,
        mape: r.mape,
        mae: r.mae,
        series: r.series,
        generatedAt,
      };
      await tx
        .insert(forecasts)
        .values(values)
        .onConflictDoUpdate({ target: [forecasts.productId, forecasts.warehouseId], set: values });
      await tx
        .update(stockLevels)
        .set({ reorderPoint: r.reorder_point, safetyStock: r.safety_stock })
        .where(and(eq(stockLevels.productId, r.product_id), eq(stockLevels.warehouseId, r.warehouse_id)));
    }
  });
  return generatedAt;
}

/**
 * Targeted refresh after a stock change or purchase order update: re-forecasts only
 * the affected product/warehouse pairs (milliseconds, not seconds), so the reorder
 * planner reflects new stock and on-order quantities immediately.
 * Best effort — if the forecasting service is down, the nightly run catches up.
 */
export async function refreshPairs(pairs: { productId: string; warehouseId: string }[]) {
  if (!pairs.length || env.NODE_ENV === 'test' || state.running) return;
  try {
    const response = await callForecastService({
      ...POLICY,
      product_ids: [...new Set(pairs.map((p) => p.productId))],
      warehouse_ids: [...new Set(pairs.map((p) => p.warehouseId))],
    });
    const wanted = new Set(pairs.map((p) => `${p.productId}:${p.warehouseId}`));
    const results = response.results.filter((r) => wanted.has(`${r.product_id}:${r.warehouse_id}`));
    await persist(results, response.generated_at);
    for (const r of results) await evaluateAlert(r.product_id, r.warehouse_id);
    await invalidate('dashboard:');
    emit('forecast:updated', { count: results.length });
  } catch (err) {
    console.warn('Targeted forecast refresh skipped:', (err as Error).message);
  }
}

const state = {
  running: false,
  lastRunAt: null as string | null,
  lastDurationMs: null as number | null,
  lastSeriesCount: null as number | null,
  lastError: null as string | null,
};

export const forecastRunState = () => ({ ...state });

/**
 * Asks the FastAPI service for fresh forecasts, then (in one transaction) stores them
 * and updates each stock level's reorder point and safety stock. Node owns all writes;
 * the Python service only reads and calculates.
 */
export async function runForecasts() {
  if (state.running) return { skipped: true };
  state.running = true;
  state.lastError = null;
  const started = Date.now();
  try {
    const response = await callForecastService(POLICY);
    const generatedAt = await persist(response.results, response.generated_at);

    // New reorder points can open or close alerts.
    for (const r of response.results) await evaluateAlert(r.product_id, r.warehouse_id);
    await invalidate('dashboard:');

    state.lastRunAt = generatedAt.toISOString();
    state.lastDurationMs = Date.now() - started;
    state.lastSeriesCount = response.results.length;
    emit('forecast:completed', { generatedAt: state.lastRunAt, count: response.results.length });
    return { count: response.results.length, durationMs: state.lastDurationMs };
  } catch (err) {
    state.lastError = (err as Error).message;
    throw err;
  } finally {
    state.running = false;
  }
}

export async function lastForecastTime(): Promise<string | null> {
  const [row] = await db.select({ t: sql<string | null>`max(${forecasts.generatedAt})` }).from(forecasts);
  return row?.t ? new Date(row.t).toISOString() : null;
}
