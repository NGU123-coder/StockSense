import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, ArrowLeftRight, Pencil, ShoppingCart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, qs } from '../api/client';
import type { Movement, ProductDetail } from '../api/types';
import { BarcodeLabel } from '../components/BarcodeLabel';
import { movementLabel, POBadge, StockBadge } from '../components/Badges';
import { MovementDialog } from '../components/MovementDialog';
import { ProductForm } from '../components/ProductForm';
import { Runway } from '../components/Runway';
import { ErrorState, Skeleton, Tabs } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { date, days, inr, number, percent, shortDate, timeAgo, units } from '../lib/format';

interface History {
  history: { date: string; qty: number }[];
  forecast: { date: string; qty: number; lower: number; upper: number }[];
}

function DemandChart({ data }: { data: History }) {
  const rows = useMemo(() => {
    const out: { date: string; actual?: number; forecast?: number; band?: [number, number] }[] = data.history.map((h) => ({
      date: h.date,
      actual: h.qty,
    }));
    // Join the forecast line to the last actual point so the two read as one story.
    const last = out[out.length - 1];
    for (const f of data.forecast) {
      const existing = out.find((r) => r.date === f.date);
      if (existing) Object.assign(existing, { forecast: f.qty, band: [f.lower, f.upper] });
      else out.push({ date: f.date, forecast: f.qty, band: [f.lower, f.upper] });
    }
    if (last && last.forecast === undefined) last.forecast = last.actual;
    return out;
  }, [data]);
  const today = data.forecast[0]?.date;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={rows} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#E7EBE9" />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: '#5C6B73' }} axisLine={false} tickLine={false} minTickGap={36} />
        <YAxis tick={{ fontSize: 11, fill: '#5C6B73' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #DDE2E0', fontSize: 12 }}
          labelFormatter={(l) => date(String(l))}
          formatter={(v, name) => {
            if (name === 'band' && Array.isArray(v)) return [`${number(v[0] as number)} to ${number(v[1] as number)}`, 'Likely range'];
            return [number(Number(v), 1), name === 'actual' ? 'Sold' : 'Forecast'];
          }}
        />
        <Area dataKey="band" stroke="none" fill="#E8A317" fillOpacity={0.16} isAnimationActive={false} />
        <Line dataKey="actual" stroke="#14213D" strokeWidth={1.6} dot={false} isAnimationActive={false} />
        <Line dataKey="forecast" stroke="#C98A0B" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        {today && <ReferenceLine x={today} stroke="#8A979D" strokeDasharray="2 3" label={{ value: 'Today', position: 'insideTopLeft', fontSize: 11, fill: '#5C6B73' }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Shows the reorder maths with this product's real numbers — the model is explainable, not a black box. */
function WhyThisOrder({
  stock,
  forecast,
  unit,
  onOrder,
}: {
  stock: ProductDetail['stock'][number];
  forecast: History['forecast'];
  unit: string;
  onOrder: number;
}) {
  const f = stock.forecast;
  if (!f) return <p className="text-[13px] text-muted">No forecast yet for this warehouse. Run a forecast to see the plan.</p>;
  const z = 1.645;
  const L = f.leadTimeDays;
  const leadDemand = forecast.slice(0, L).reduce((s, p) => s + p.qty, 0);
  const coverDemand = forecast.slice(0, L + 14).reduce((s, p) => s + p.qty, 0);
  const position = stock.quantity + onOrder;
  const below = position <= stock.reorderPoint;

  const Row = ({ label, value, formula, strong }: { label: string; value: string; formula?: string; strong?: boolean }) => (
    <div className={clsx('grid grid-cols-[1fr_auto] gap-x-4 py-2', strong && 'font-semibold')}>
      <span>{label}</span>
      <span className="num text-right">{value}</span>
      {formula && <span className="col-span-2 text-[12px] text-muted">{formula}</span>}
    </div>
  );

  return (
    <div className="divide-y divide-line text-[13px]">
      <Row label="Expected sales per day" value={number(f.avgDailyDemand, 1)} formula={`Holt-Winters forecast, next 30 days. Daily variation (σ) ${number(f.demandStdDev, 1)}.`} />
      <Row label="Supplier lead time" value={`${L} days`} />
      <Row label="Safety stock" value={number(stock.safetyStock)} formula={`${z} × ${number(f.demandStdDev, 1)} × √${L}, for a 95% chance of not running out`} />
      <Row
        label="Reorder point"
        value={number(stock.reorderPoint)}
        formula={`Sales during lead time (${number(leadDemand)}) + safety stock (${number(stock.safetyStock)})`}
        strong
      />
      <Row label="On hand + already on order" value={number(position)} formula={`${number(stock.quantity)} + ${number(onOrder)}`} />
      {below ? (
        <div className="py-3">
          <div className="flex items-baseline justify-between gap-4 font-semibold">
            <span>Order now</span>
            <span className="num font-wide text-[22px] text-signal-ink">
              {units(f.recommendedOrderQty, unit)}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            Covers lead time plus 14 days ({number(coverDemand)}) + safety stock − stock position ({number(position)}).
          </p>
        </div>
      ) : (
        <div className="py-3 font-semibold text-stock">Above the reorder point. No order needed yet.</div>
      )}
      {f.excessQty > 0 && (
        <p className="py-3 text-[12.5px] text-signal-ink">
          {units(f.excessQty, unit)} are more than 60 days of demand. Consider transferring them to a busier warehouse.
        </p>
      )}
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { allowed } = useAuth();
  const { warehouseId: scopeId } = useWarehouseScope();
  const [wh, setWh] = useState<string>(scopeId ?? '');
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);

  const product = useQuery({ queryKey: ['product', id], queryFn: () => api.get<ProductDetail>(`/products/${id}`) });
  const history = useQuery({
    queryKey: ['product-history', id, wh],
    queryFn: () => api.get<History>(`/products/${id}/history${qs({ warehouseId: wh, days: 90 })}`),
  });
  // When the chart shows all warehouses, fetch the most urgent warehouse's own forecast for the plan.
  const planTarget = wh || (product.data ? [...product.data.stock].sort((a, b) => (a.forecast?.daysOfCover ?? 999) - (b.forecast?.daysOfCover ?? 999))[0]?.warehouseId : '');
  const planHistory = useQuery({
    queryKey: ['product-history', id, planTarget],
    queryFn: () => api.get<History>(`/products/${id}/history${qs({ warehouseId: planTarget, days: 90 })}`),
    enabled: !wh && !!planTarget,
  });
  const movements = useQuery({
    queryKey: ['product-movements', id],
    queryFn: () => api.get<Movement[]>(`/products/${id}/movements`),
  });

  if (product.error) return <ErrorState error={product.error} onRetry={() => product.refetch()} />;
  if (!product.data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const p = product.data;
  const totalQty = p.stock.reduce((s, x) => s + x.quantity, 0);
  const totalRop = p.stock.reduce((s, x) => s + x.reorderPoint, 0);
  const lowCount = p.stock.filter((s) => s.quantity <= s.reorderPoint).length;
  const status = totalQty === 0 ? 'out' : lowCount > 0 ? 'low' : 'ok';
  // The reorder plan always shows a warehouse: the chosen one, or else the most urgent.
  const urgent = [...p.stock].sort((a, b) => (a.forecast?.daysOfCover ?? 999) - (b.forecast?.daysOfCover ?? 999))[0];
  const planWh = wh || urgent?.warehouseId || '';
  const selected = p.stock.find((s) => s.warehouseId === planWh) ?? null;
  const planSeries = wh ? history.data?.forecast : planHistory.data?.forecast;
  const onOrderFor = (warehouseId: string) =>
    p.openOrders.filter((o) => o.warehouseId === warehouseId && o.status !== 'DRAFT').reduce((s, o) => s + o.quantity, 0);
  const margin = (p.sellPrice - p.costPrice) / p.sellPrice;

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={14} /> Back
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="sku">{p.sku}</span>
            <span className="text-[12px] text-faint">{p.category}</span>
            <StockBadge status={status} detail={status === 'low' ? `Low in ${lowCount} of ${p.stock.length} warehouses` : undefined} />
          </div>
          <h1 className="page-title">{p.name}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {p.supplier ? (
              <>
                Supplied by <Link to="/suppliers" className="font-medium text-ink hover:underline">{p.supplier.name}</Link>, {p.supplier.leadTimeDays} day lead time.{' '}
              </>
            ) : (
              'No supplier assigned. '
            )}
            Cost {inr(p.costPrice, { compact: false })}, sells at {inr(p.sellPrice, { compact: false })} ({percent(margin)} margin).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {allowed('manageCatalog') && (
            <button className="btn-ghost" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
          )}
          {allowed('moveStock') && (
            <button className="btn-ghost" onClick={() => setMoving(true)}>
              <ArrowLeftRight size={14} /> Record movement
            </button>
          )}
          {allowed('createPO') && p.supplier && (
            <Link className="btn-primary" to={`/purchase-orders/new?product=${p.id}${wh ? `&warehouse=${wh}` : ''}`}>
              <ShoppingCart size={14} /> Order more
            </Link>
          )}
        </div>
      </div>

      <section className="panel mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-4">
          <div>
            <h2 className="section-title">Daily sales and 30-day forecast</h2>
            <p className="text-[12px] text-muted">Solid line is actual sales. Dashed line is the forecast, shaded area the likely range.</p>
          </div>
        </div>
        <div className="px-5">
          <Tabs
            value={wh}
            onChange={setWh}
            items={[{ value: '', label: 'All warehouses' }, ...p.stock.map((s) => ({ value: s.warehouseId, label: s.warehouseName }))]}
          />
        </div>
        <div className="px-3 pt-4 pb-3">
          {history.data ? <DemandChart data={history.data} /> : <Skeleton className="mx-2 h-[300px]" />}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="section-title">Stock by warehouse</h2>
            <p className="num text-[12px] text-muted">
              {units(totalQty, p.unit)} in total, combined reorder point {number(totalRop)}
            </p>
          </div>
          <ul>
            {p.stock.map((s) => {
              const onOrder = onOrderFor(s.warehouseId);
              return (
                <li
                  key={s.warehouseId}
                  className={clsx(
                    'grid cursor-pointer gap-x-6 gap-y-3 border-b border-line px-5 py-4 last:border-0 sm:grid-cols-[150px_1fr_auto]',
                    planWh === s.warehouseId ? 'bg-concrete/80' : 'hover:bg-concrete/50',
                  )}
                  onClick={() => setWh(s.warehouseId)}
                >
                  <div>
                    <p className="font-semibold">{s.warehouseName}</p>
                    <p className="text-[12px] text-muted">
                      {s.forecast ? `${number(s.forecast.avgDailyDemand, 1)} sold per day` : 'No forecast yet'}
                    </p>
                  </div>
                  <div className="pt-1">
                    <Runway quantity={s.quantity} reorderPoint={s.reorderPoint} safetyStock={s.safetyStock} size="md" showLabels />
                  </div>
                  <div className="text-right sm:min-w-[110px]">
                    <p className="num font-wide text-[18px] font-[750]">{number(s.quantity)}</p>
                    <p className={clsx('text-[12px]', (s.forecast?.daysOfCover ?? 99) < (s.forecast?.leadTimeDays ?? 0) ? 'font-semibold text-out' : 'text-muted')}>
                      {days(s.forecast?.daysOfCover)} of cover
                    </p>
                    {onOrder > 0 && <p className="text-[12px] text-sky">+{number(onOrder)} on order</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <div className="border-b border-line px-5 py-4">
            <h2 className="section-title">How much to order</h2>
            <p className="text-[12px] text-muted">
              {selected ? `${selected.warehouseName}${wh ? '' : ' (most urgent)'}, using today's forecast` : 'No stock records yet'}
            </p>
          </div>
          <div className="px-5 py-2">
            {selected && planSeries ? (
              <WhyThisOrder stock={selected} forecast={planSeries} unit={p.unit} onOrder={onOrderFor(selected.warehouseId)} />
            ) : (
              <Skeleton className="my-3 h-64" />
            )}
          </div>
          {selected?.forecast && (
            <p className="border-t border-line px-5 py-3 text-[12px] text-muted">
              Forecast error over the last 4 weeks: {percent(selected.forecast.mape)}. Updated {timeAgo(selected.forecast.generatedAt)}.
            </p>
          )}
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="panel p-5">
          <h2 className="section-title mb-4">Shelf label</h2>
          {p.barcode ? <BarcodeLabel code={p.barcode} name={p.name} sku={p.sku} price={p.sellPrice} /> : <p className="text-[13px] text-muted">No barcode on file.</p>}
        </section>

        <section className="panel p-5">
          <h2 className="section-title mb-3">Open purchase orders</h2>
          {p.openOrders.length === 0 ? (
            <p className="text-[13px] text-muted">Nothing on order.</p>
          ) : (
            <ul className="space-y-3">
              {p.openOrders.map((o) => (
                <li key={o.poId} className="flex items-center justify-between gap-3 text-[13px]">
                  <div>
                    <Link to={`/purchase-orders/${o.poId}`} className="font-semibold hover:underline">
                      {o.poNumber}
                    </Link>
                    <p className="text-[12px] text-muted">
                      {units(o.quantity, p.unit)}, due {date(o.expectedDate)}
                    </p>
                  </div>
                  <POBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="section-title mb-3">Stock history</h2>
          {movements.data?.length === 0 && <p className="text-[13px] text-muted">No manual movements yet.</p>}
          <ul className="space-y-3">
            {movements.data?.slice(0, 7).map((m) => (
              <li key={m.id} className="flex gap-3 text-[13px]">
                <span className={clsx('num w-14 shrink-0 text-right font-semibold', m.quantity > 0 ? 'text-stock' : 'text-out')}>
                  {m.quantity > 0 ? '+' : '−'}
                  {number(Math.abs(m.quantity))}
                </span>
                <div className="min-w-0">
                  <p>
                    {movementLabel[m.type]} at {m.warehouseName}
                  </p>
                  <p className="truncate text-[12px] text-muted">
                    {[m.reference, m.note].filter(Boolean).join(', ') || 'No note'}. {m.userName}, {timeAgo(m.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <ProductForm open={editing} onClose={() => setEditing(false)} product={p} />
      <MovementDialog
        open={moving}
        onClose={() => setMoving(false)}
        productId={p.id}
        productLabel={`${p.name} (${p.sku})`}
        warehouseId={wh || null}
      />
    </>
  );
}
