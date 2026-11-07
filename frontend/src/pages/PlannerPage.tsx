import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeftRight, ShoppingCart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { api, qs } from '../api/client';
import type { Recommendation } from '../api/types';
import { MovementDialog } from '../components/MovementDialog';
import { RecalculateButton } from '../components/RecalculateButton';
import { Runway } from '../components/Runway';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { days, inr, number, percent } from '../lib/format';

type View = 'reorder' | 'excess';
const key = (r: Recommendation) => `${r.productId}:${r.warehouseId}`;

export default function PlannerPage() {
  const { warehouseId } = useWarehouseScope();
  const { allowed } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('reorder');
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = all selected
  const [transfer, setTransfer] = useState<{ r: Recommendation; to: Recommendation; qty: number } | null>(null);

  // One request for everything; the two views and transfer suggestions are derived client-side.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['recommendations', warehouseId],
    queryFn: () => api.get<{ items: Recommendation[] }>(`/forecasts/recommendations${qs({ warehouseId, view: 'all' })}`),
  });
  // Transfer suggestions need other warehouses too, even when one warehouse is selected.
  const everywhere = useQuery({
    queryKey: ['recommendations', 'all-warehouses'],
    queryFn: () => api.get<{ items: Recommendation[] }>(`/forecasts/recommendations?view=all`),
    enabled: view === 'excess',
  });

  const reorder = useMemo(
    () =>
      (data?.items ?? [])
        .filter((r) => r.recommendedOrderQty > 0)
        .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0)),
    [data],
  );
  const excess = useMemo(
    () => (data?.items ?? []).filter((r) => r.excessQty > 0).sort((a, b) => b.excessValue - a.excessValue),
    [data],
  );
  const selected = picked ?? new Set(reorder.map(key));
  const chosen = reorder.filter((r) => selected.has(key(r)));
  const totals = {
    orderValue: chosen.reduce((s, r) => s + r.orderValue, 0),
    atRisk: reorder.reduce((s, r) => s + r.revenueAtRisk, 0),
    excessValue: excess.reduce((s, r) => s + r.excessValue, 0),
  };
  const supplierCount = new Set(chosen.map((r) => `${r.supplierId}:${r.warehouseId}`)).size;

  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setPicked(next);
  };

  const create = useMutation({
    mutationFn: async () => {
      const byWarehouse = new Map<string, string[]>();
      for (const r of chosen) byWarehouse.set(r.warehouseId, [...(byWarehouse.get(r.warehouseId) ?? []), r.productId]);
      const created: { id: string }[] = [];
      for (const [wh, productIds] of byWarehouse) {
        created.push(...(await api.post<{ id: string }[]>('/purchase-orders/from-recommendations', { warehouseId: wh, productIds })));
      }
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`${created.length} draft purchase ${created.length === 1 ? 'order' : 'orders'} created`, {
        description: 'Review and submit them for approval.',
        action: { label: 'Open', onClick: () => navigate('/purchase-orders?status=DRAFT') },
      });
      setPicked(new Set());
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const suggestionFor = (r: Recommendation) => {
    const needs = (everywhere.data?.items ?? [])
      .filter((x) => x.productId === r.productId && x.warehouseId !== r.warehouseId && x.recommendedOrderQty > 0)
      .sort((a, b) => b.recommendedOrderQty - a.recommendedOrderQty)[0];
    return needs ? { to: needs, qty: Math.min(r.excessQty, needs.recommendedOrderQty) } : null;
  };

  return (
    <>
      <PageHeader
        title="Reorder planner"
        subtitle="What to buy, how much, and what it costs, based on each item's demand forecast and supplier lead time."
        actions={<RecalculateButton />}
      />

      <div className="mb-5 grid gap-px overflow-hidden rounded-[var(--radius-lg)] border border-line bg-line sm:grid-cols-3 [&>*]:bg-surface">
        <div className="px-5 py-4">
          <p className="text-[12.5px] text-muted">Items to reorder</p>
          <p className="num font-wide mt-1 text-[24px] font-[750]">{reorder.length}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12.5px] text-muted">Sales at risk if nothing is ordered</p>
          <p className="num font-wide mt-1 text-[24px] font-[750] text-out">{inr(totals.atRisk)}</p>
        </div>
        <div className="px-5 py-4">
          <p className="text-[12.5px] text-muted">Cash tied up in overstock</p>
          <p className="num font-wide mt-1 text-[24px] font-[750] text-signal-ink">{inr(totals.excessValue)}</p>
        </div>
      </div>

      <div className="panel">
        <div className="px-4 pt-2">
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'reorder', label: 'Reorder now', count: reorder.length },
              { value: 'excess', label: 'Overstock', count: excess.length },
            ]}
          />
        </div>

        {error && (
          <div className="p-4">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        )}
        {isLoading && <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>}

        {data && view === 'reorder' && (
          <>
            {reorder.length === 0 ? (
              <EmptyState title="Nothing needs reordering" body="Every item has enough stock, or enough already on order, to last until new stock arrives." />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-concrete/50 px-4 py-3">
                  <p className="text-[13px]">
                    <span className="font-semibold">{chosen.length} selected</span>
                    <span className="text-muted">
                      {' '}
                      for {inr(totals.orderValue)}, grouped into {supplierCount} {supplierCount === 1 ? 'order' : 'orders'} by supplier and warehouse
                    </span>
                  </p>
                  {allowed('createPO') && (
                    <button className="btn-signal" disabled={!chosen.length || create.isPending} onClick={() => create.mutate()}>
                      <ShoppingCart size={15} />
                      {create.isPending ? 'Creating…' : 'Create draft orders'}
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="table min-w-[980px]">
                    <thead>
                      <tr>
                        <th className="w-10">
                          <input
                            type="checkbox"
                            aria-label="Select all"
                            checked={chosen.length === reorder.length}
                            onChange={(e) => setPicked(e.target.checked ? null : new Set())}
                            className="size-4 accent-ink"
                          />
                        </th>
                        <th>Product</th>
                        <th>Warehouse</th>
                        <th className="w-[20%]">Stock vs reorder point</th>
                        <th className="text-right">Runs out</th>
                        <th className="text-right">Order</th>
                        <th className="text-right">Cost</th>
                        <th>Supplier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorder.map((r) => {
                        const late = (r.daysOfCover ?? 0) < r.leadTimeDays;
                        return (
                          <tr key={key(r)} className={clsx(!selected.has(key(r)) && 'opacity-55')}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Select ${r.name} for ${r.warehouseName}`}
                                checked={selected.has(key(r))}
                                onChange={() => toggle(key(r))}
                                className="size-4 accent-ink"
                              />
                            </td>
                            <td>
                              <Link to={`/products/${r.productId}`} className="font-semibold hover:underline">
                                {r.name}
                              </Link>
                              <div className="sku">{r.sku}</div>
                            </td>
                            <td className="text-muted">{r.warehouseName}</td>
                            <td>
                              <Runway quantity={r.onHand} reorderPoint={r.reorderPoint} safetyStock={r.safetyStock} />
                              <p className="num mt-1 text-[11.5px] text-muted">
                                {number(r.onHand)} on hand{r.onOrder ? `, ${number(r.onOrder)} on order` : ''}
                              </p>
                            </td>
                            <td className="text-right">
                              <p className={clsx('num font-semibold', late && 'text-out')}>{days(r.daysOfCover)}</p>
                              <p className="text-[11.5px] whitespace-nowrap text-muted" title={late ? 'Runs out before a new order could arrive' : undefined}>
                                {r.leadTimeDays}-day lead time
                              </p>
                            </td>
                            <td className="num text-right font-semibold">
                              {number(r.recommendedOrderQty)} <span className="font-normal text-muted">{r.unit}</span>
                            </td>
                            <td className="num text-right">{inr(r.orderValue)}</td>
                            <td className="text-muted">{r.supplierName ?? 'No supplier'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {data && view === 'excess' && (
          <>
            {excess.length === 0 ? (
              <EmptyState title="No overstock" body="No item holds more than 60 days of expected demand." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table min-w-[900px]">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Warehouse</th>
                      <th className="text-right">On hand</th>
                      <th className="text-right">Cover</th>
                      <th className="text-right">Excess</th>
                      <th className="text-right">Cash tied up</th>
                      <th>Suggestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {excess.map((r) => {
                      const s = suggestionFor(r);
                      return (
                        <tr key={key(r)}>
                          <td>
                            <Link to={`/products/${r.productId}`} className="font-semibold hover:underline">
                              {r.name}
                            </Link>
                            <div className="sku">{r.sku}</div>
                          </td>
                          <td className="text-muted">{r.warehouseName}</td>
                          <td className="num text-right">{number(r.onHand)}</td>
                          <td className="num text-right">{days(r.daysOfCover)}</td>
                          <td className="num text-right font-semibold">{number(r.excessQty)}</td>
                          <td className="num text-right font-semibold text-signal-ink">{inr(r.excessValue)}</td>
                          <td>
                            {s && allowed('moveStock') ? (
                              <button className="btn-ghost h-8" onClick={() => setTransfer({ r, to: s.to, qty: s.qty })}>
                                <ArrowLeftRight size={14} /> Send {number(s.qty)} to {s.to.warehouseName}
                              </button>
                            ) : s ? (
                              <span className="text-[12.5px]">
                                {s.to.warehouseName} needs {number(s.to.recommendedOrderQty)}
                              </span>
                            ) : (
                              <span className="text-[12.5px] text-muted">Pause reorders; consider a promotion</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {data && data.items[0] && (
          <p className="border-t border-line px-4 py-3 text-[12px] text-muted">
            Average forecast error is {percent(data.items.reduce((s, r) => s + (r.mape ?? 0), 0) / data.items.length)} across{' '}
            {data.items.length} forecasts. Run-out dates assume no new deliveries arrive.
          </p>
        )}
      </div>

      {transfer && (
        <MovementDialog
          open
          onClose={() => setTransfer(null)}
          productId={transfer.r.productId}
          productLabel={`${transfer.r.name} (${transfer.r.sku})`}
          warehouseId={transfer.r.warehouseId}
          toWarehouseId={transfer.to.warehouseId}
          quantity={transfer.qty}
          initialKind="TRANSFER"
        />
      )}
    </>
  );
}
