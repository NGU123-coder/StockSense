import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownRight, ArrowUpRight, ClipboardList } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, qs } from '../api/client';
import { useWarehouses } from '../api/queries';
import type { DashboardSummary } from '../api/types';
import { movementLabel } from '../components/Badges';
import { RecalculateButton } from '../components/RecalculateButton';
import { Runway } from '../components/Runway';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { date, days, inr, number, percent, shortDate, signedPercent, timeAgo } from '../lib/format';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: React.ReactNode;
  tone?: 'signal' | 'out';
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[12.5px] font-medium text-muted">{label}</p>
      <p
        className={clsx(
          'num font-wide mt-1 text-[24px] leading-tight font-[750]',
          tone === 'out' && 'text-out',
          tone === 'signal' && 'text-signal-ink',
        )}
      >
        {value}
      </p>
      <div className="mt-1 text-[12px] text-muted">{detail}</div>
    </div>
  );
}

function Trend({ change }: { change: number | null }) {
  if (change == null) return null;
  const up = change >= 0;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 font-semibold', up ? 'text-stock' : 'text-out')}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {signedPercent(change)}
    </span>
  );
}

function SalesChart({ data }: { data: DashboardSummary['salesTrend'] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14213D" stopOpacity={0.18} />
            <stop offset="100%" stopColor="#14213D" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E7EBE9" />
        <XAxis
          dataKey="date"
          tickFormatter={shortDate}
          tick={{ fontSize: 11, fill: '#5C6B73' }}
          axisLine={false}
          tickLine={false}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => inr(v)}
          tick={{ fontSize: 11, fill: '#5C6B73' }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          cursor={{ stroke: '#C6CDCA' }}
          contentStyle={{ borderRadius: 8, border: '1px solid #DDE2E0', fontSize: 12 }}
          labelFormatter={(l) => date(String(l))}
          formatter={(v, name) => (name === 'revenue' ? [inr(Number(v), { compact: false }), 'Sales'] : [number(Number(v)), 'Units'])}
        />
        <Area type="monotone" dataKey="revenue" stroke="#14213D" strokeWidth={2} fill="url(#rev)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ValueBars({ rows }: { rows: { label: string; value: number; to?: string }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-[13px]">
            <span className="truncate font-medium">{r.label}</span>
            <span className="num shrink-0 text-muted">{inr(r.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-concrete">
            <div className="runway-fill h-full rounded-full bg-ink-3" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { warehouseId } = useWarehouseScope();
  const { data: warehouses } = useWarehouses();
  const scopeName = warehouseId ? warehouses?.find((w) => w.id === warehouseId)?.name : 'All warehouses';
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', warehouseId],
    queryFn: () => api.get<DashboardSummary>(`/dashboard/summary${qs({ warehouseId })}`),
  });

  const header = (
    <PageHeader
      title={`${greeting()}, ${user?.name.split(' ')[0]}`}
      subtitle={`${scopeName ?? ''}. Here is what needs your attention today.`}
      actions={<RecalculateButton />}
    />
  );

  if (error) return (<>{header}<ErrorState error={error} onRetry={() => refetch()} /></>);
  if (isLoading || !data) {
    return (
      <>
        {header}
        <Skeleton className="mb-5 h-16" />
        <Skeleton className="mb-5 h-28" />
        <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </>
    );
  }

  const k = data.kpis;
  const revenueChange = k.revenuePrev30d ? (k.revenue30d - k.revenuePrev30d) / k.revenuePrev30d : null;

  return (
    <>
      {header}

      {k.reorderItems > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-signal/40 bg-signal-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-signal text-ink">
              <ClipboardList size={16} />
            </span>
            <div>
              <p className="font-semibold text-ink">
                {k.reorderItems} {k.reorderItems === 1 ? 'item has' : 'items have'} reached the reorder point
              </p>
              <p className="text-[13px] text-signal-ink">
                Suggested purchase of {inr(k.reorderValue)} protects about {inr(k.revenueAtRisk)} of sales that would
                otherwise be lost to stockouts.
              </p>
            </div>
          </div>
          <Link to="/planner" className="btn-primary">
            Review reorder plan
          </Link>
        </div>
      )}

      {/* One band split by hairlines (gap-px over a line-coloured background), not five floating cards. */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line md:grid-cols-3 xl:grid-cols-5 [&>*]:bg-surface [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1">
        <Kpi label="Stock value" value={inr(k.stockValue)} detail={`${number(k.totalUnits)} units across ${k.skuCount} products`} />
        <Kpi
          label="Sales, last 30 days"
          value={inr(k.revenue30d)}
          detail={
            <>
              <Trend change={revenueChange} /> vs previous 30 days
            </>
          }
        />
        <Kpi
          label="Sales at risk"
          value={inr(k.revenueAtRisk)}
          tone={k.revenueAtRisk > 0 ? 'out' : undefined}
          detail="Items that run out before new stock can arrive"
        />
        <Kpi
          label="Cash in overstock"
          value={inr(k.overstockValue)}
          tone={k.overstockValue > 0 ? 'signal' : undefined}
          detail="Stock beyond 60 days of expected demand"
        />
        <Kpi
          label="Open purchase orders"
          value={inr(k.openPoValue)}
          detail={
            <Link to="/purchase-orders" className="hover:underline">
              {k.pendingApproval} awaiting approval{k.overduePos ? `, ${k.overduePos} overdue` : ''}
            </Link>
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <section className="panel">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="section-title">Running low</h2>
              <p className="text-[12px] text-muted">At or below reorder point, most urgent first</p>
            </div>
            <Link to="/products?status=low" className="text-[13px] font-semibold text-sky hover:underline">
              See all
            </Link>
          </div>
          {data.needsAttention.length === 0 ? (
            <EmptyState title="Every item is above its reorder point" body="Nice. New alerts will appear here the moment stock dips." />
          ) : (
            <ul>
              {data.needsAttention.map((r) => (
                <li
                  key={`${r.productId}-${r.warehouseCode}`}
                  onClick={() => navigate(`/products/${r.productId}`)}
                  className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line px-5 py-3.5 last:border-0 hover:bg-concrete/60 sm:grid-cols-[minmax(0,1.3fr)_minmax(140px,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <Link to={`/products/${r.productId}`} className="block truncate font-semibold hover:underline">
                      {r.name}
                    </Link>
                    <p className="text-[12px] text-muted">
                      {r.warehouseName} <span className="sku ml-1">{r.sku}</span>
                    </p>
                  </div>
                  <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                    <Runway quantity={r.quantity} reorderPoint={r.reorderPoint} />
                    <p className="num mt-1 text-[11.5px] text-muted">
                      {number(r.quantity)} on hand, reorder at {number(r.reorderPoint)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={clsx('num font-semibold', r.quantity === 0 || (r.daysOfCover ?? 99) < 3 ? 'text-out' : 'text-ink')}>
                      {days(r.daysOfCover)}
                    </p>
                    <p className="text-[11.5px] text-muted">
                      {r.recommendedOrderQty > 0 ? `order ${number(r.recommendedOrderQty)}` : 'on order'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel flex flex-col">
          <div className="flex items-end justify-between border-b border-line px-5 py-4">
            <div>
              <h2 className="section-title">Sales, last 30 days</h2>
              <p className="text-[12px] text-muted">{number(k.units30d)} units sold</p>
            </div>
            <p className="text-[12px] text-muted">
              Forecast error {percent(k.avgMape)}
            </p>
          </div>
          <div className="flex-1 px-3 pt-4 pb-2">
            <SalesChart data={data.salesTrend} />
          </div>
          <div className="border-t border-line px-5 py-4">
            <h3 className="mb-3 text-[13px] font-semibold">Best sellers</h3>
            <ol className="space-y-2">
              {data.topMovers.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <Link to={`/products/${m.id}`} className="truncate hover:underline">
                    {m.name}
                  </Link>
                  <span className="num flex shrink-0 items-center gap-3">
                    <span className="text-muted">{number(m.units)} units</span>
                    <span className="w-[62px] text-right text-[12px]"><Trend change={m.change} /></span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>

      <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        <section className="panel p-5">
          <h2 className="section-title mb-4">Stock value by warehouse</h2>
          <ValueBars rows={data.valueByWarehouse.map((w) => ({ label: w.name, value: w.value }))} />
        </section>
        <section className="panel p-5">
          <h2 className="section-title mb-4">Stock value by category</h2>
          <ValueBars rows={data.valueByCategory.slice(0, 6).map((c) => ({ label: c.category, value: c.value }))} />
        </section>
        <section className="panel p-5 md:col-span-2 xl:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Recent activity</h2>
            <Link to="/stock" className="text-[13px] font-semibold text-sky hover:underline">
              Stock moves
            </Link>
          </div>
          <ul className="space-y-3">
            {data.recentActivity.slice(0, 6).map((a) => (
              <li key={a.id} className="flex gap-3 text-[13px]">
                <span
                  className={clsx(
                    'num mt-0.5 w-12 shrink-0 text-right font-semibold',
                    a.quantity > 0 ? 'text-stock' : 'text-out',
                  )}
                >
                  {a.quantity > 0 ? '+' : '−'}
                  {number(Math.abs(a.quantity))}
                </span>
                <div className="min-w-0">
                  <p className="truncate">
                    <span className="font-medium">{movementLabel[a.type]}</span>{' '}
                    <Link to={`/products/${a.productId}`} className="hover:underline">
                      {a.productName}
                    </Link>
                  </p>
                  <p className="text-[12px] text-muted">
                    {a.warehouseName}, {a.userName} {timeAgo(a.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
