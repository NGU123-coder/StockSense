import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { cached } from '../../lib/cache';
import { validate } from '../../middleware/validate';

export const dashboardRouter = Router();

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

/**
 * Everything the dashboard needs in one request. The queries are aggregation-heavy,
 * so the result is cached in Redis for 60 seconds and invalidated on every stock change.
 */
async function buildSummary(warehouseId?: string) {
  const wh = (col: string) => (warehouseId ? sql`and ${sql.raw(col)} = ${warehouseId}` : sql``);

  const [kpi, sales, trend, byWarehouse, byCategory, movers, attention, activity, fc] = await Promise.all([
    db.execute<Row>(sql`
      select
        coalesce(sum(s.quantity * p.cost_price), 0) as stock_value,
        coalesce(sum(s.quantity), 0) as total_units,
        count(distinct p.id) filter (where p.is_active) as sku_count,
        count(*) filter (where s.quantity = 0) as out_of_stock,
        count(*) filter (where s.quantity > 0 and s.quantity <= s.reorder_point) as low_stock
      from stock_levels s join products p on p.id = s.product_id
      where p.is_active ${wh('s.warehouse_id')}`),
    db.execute<Row>(sql`
      select
        coalesce(sum(-m.quantity * p.sell_price) filter (where m.created_at >= now() - interval '30 days'), 0) as revenue_30d,
        coalesce(sum(-m.quantity * p.sell_price) filter (where m.created_at < now() - interval '30 days'), 0) as revenue_prev_30d,
        coalesce(sum(-m.quantity) filter (where m.created_at >= now() - interval '30 days'), 0) as units_30d,
        coalesce(sum(-m.quantity) filter (where m.created_at < now() - interval '30 days'), 0) as units_prev_30d
      from stock_movements m join products p on p.id = m.product_id
      where m.type = 'SALE' and m.created_at >= now() - interval '60 days' ${wh('m.warehouse_id')}`),
    db.execute<Row>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as date,
             coalesce(sum(-m.quantity * p.sell_price), 0) as revenue,
             coalesce(sum(-m.quantity), 0) as units
      from generate_series(current_date - 29, current_date, interval '1 day') d(day)
      left join stock_movements m on m.type = 'SALE' and m.created_at::date = d.day::date ${wh('m.warehouse_id')}
      left join products p on p.id = m.product_id
      group by d.day order by d.day`),
    db.execute<Row>(sql`
      select w.id, w.name, w.code, coalesce(sum(s.quantity * p.cost_price), 0) as value
      from warehouses w
      left join stock_levels s on s.warehouse_id = w.id
      left join products p on p.id = s.product_id and p.is_active
      group by w.id order by value desc`),
    db.execute<Row>(sql`
      select p.category, coalesce(sum(s.quantity * p.cost_price), 0) as value
      from stock_levels s join products p on p.id = s.product_id
      where p.is_active ${wh('s.warehouse_id')}
      group by p.category order by value desc`),
    db.execute<Row>(sql`
      select p.id, p.name, p.sku,
        coalesce(sum(-m.quantity) filter (where m.created_at >= now() - interval '30 days'), 0) as units,
        coalesce(sum(-m.quantity) filter (where m.created_at < now() - interval '30 days'), 0) as prev_units
      from stock_movements m join products p on p.id = m.product_id
      where m.type = 'SALE' and m.created_at >= now() - interval '60 days' ${wh('m.warehouse_id')}
      group by p.id order by units desc limit 6`),
    db.execute<Row>(sql`
      select p.id as product_id, p.name, p.sku, w.name as warehouse_name, w.code as warehouse_code,
             s.quantity, s.reorder_point, f.days_of_cover, f.recommended_order_qty, f.stockout_date
      from stock_levels s
      join products p on p.id = s.product_id
      join warehouses w on w.id = s.warehouse_id
      left join forecasts f on f.product_id = s.product_id and f.warehouse_id = s.warehouse_id
      where p.is_active and s.quantity <= s.reorder_point ${wh('s.warehouse_id')}
      order by s.quantity = 0 desc, f.days_of_cover asc nulls last limit 8`),
    db.execute<Row>(sql`
      select m.id, m.type, m.quantity, m.reference, m.created_at, p.name as product_name, p.id as product_id,
             w.name as warehouse_name, u.name as user_name
      from stock_movements m
      join products p on p.id = m.product_id
      join warehouses w on w.id = m.warehouse_id
      left join users u on u.id = m.user_id
      where m.user_id is not null ${wh('m.warehouse_id')}
      order by m.created_at desc limit 8`),
    db.execute<Row>(sql`
      select
        coalesce(sum(f.excess_qty * p.cost_price), 0) as overstock_value,
        coalesce(sum(case when f.days_of_cover < f.lead_time_days
          then f.avg_daily_demand * (f.lead_time_days - f.days_of_cover) * p.sell_price else 0 end), 0) as revenue_at_risk,
        coalesce(sum(f.recommended_order_qty * p.cost_price), 0) as reorder_value,
        count(*) filter (where f.recommended_order_qty > 0) as reorder_items,
        avg(f.mape) filter (where f.mape is not null) as avg_mape,
        max(f.generated_at) as generated_at
      from forecasts f join products p on p.id = f.product_id
      where p.is_active ${wh('f.warehouse_id')}`),
  ]);

  const po = await db.execute<Row>(sql`
    select
      count(*) filter (where status in ('SUBMITTED','APPROVED')) as open_count,
      coalesce(sum(total_amount) filter (where status in ('SUBMITTED','APPROVED')), 0) as open_value,
      count(*) filter (where status = 'SUBMITTED') as pending_approval,
      count(*) filter (where status = 'APPROVED' and expected_date < now()) as overdue
    from purchase_orders where true ${wh('warehouse_id')}`);

  const k = kpi.rows[0];
  const s = sales.rows[0];
  const f = fc.rows[0];
  const p = po.rows[0];
  return {
    kpis: {
      stockValue: num(k.stock_value),
      totalUnits: num(k.total_units),
      skuCount: num(k.sku_count),
      lowStock: num(k.low_stock),
      outOfStock: num(k.out_of_stock),
      revenue30d: num(s.revenue_30d),
      revenuePrev30d: num(s.revenue_prev_30d),
      units30d: num(s.units_30d),
      unitsPrev30d: num(s.units_prev_30d),
      overstockValue: num(f.overstock_value),
      revenueAtRisk: num(f.revenue_at_risk),
      reorderValue: num(f.reorder_value),
      reorderItems: num(f.reorder_items),
      avgMape: f.avg_mape == null ? null : Number(f.avg_mape),
      forecastGeneratedAt: iso(f.generated_at),
      openPoCount: num(p.open_count),
      openPoValue: num(p.open_value),
      pendingApproval: num(p.pending_approval),
      overduePos: num(p.overdue),
    },
    salesTrend: trend.rows.map((r) => ({ date: r.date, revenue: num(r.revenue), units: num(r.units) })),
    valueByWarehouse: byWarehouse.rows.map((r) => ({ id: r.id, name: r.name, code: r.code, value: num(r.value) })),
    valueByCategory: byCategory.rows.map((r) => ({ category: r.category, value: num(r.value) })),
    topMovers: movers.rows.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      units: num(r.units),
      change: num(r.prev_units) ? (num(r.units) - num(r.prev_units)) / num(r.prev_units) : null,
    })),
    needsAttention: attention.rows.map((r) => ({
      productId: r.product_id,
      name: r.name,
      sku: r.sku,
      warehouseName: r.warehouse_name,
      warehouseCode: r.warehouse_code,
      quantity: num(r.quantity),
      reorderPoint: num(r.reorder_point),
      daysOfCover: r.days_of_cover == null ? null : Number(r.days_of_cover),
      recommendedOrderQty: num(r.recommended_order_qty),
      stockoutDate: iso(r.stockout_date),
    })),
    recentActivity: activity.rows.map((r) => ({
      id: r.id,
      type: r.type,
      quantity: num(r.quantity),
      reference: r.reference,
      createdAt: iso(r.created_at),
      productName: r.product_name,
      productId: r.product_id,
      warehouseName: r.warehouse_name,
      userName: r.user_name,
    })),
  };
}

dashboardRouter.get(
  '/summary',
  validate({ query: z.object({ warehouseId: z.uuid().optional() }) }),
  async (_req, res) => {
    const { warehouseId } = res.locals.query as { warehouseId?: string };
    res.json(await cached(`dashboard:${warehouseId ?? 'all'}`, 60, () => buildSummary(warehouseId)));
  },
);
