import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, qs } from '../api/client';
import type { Movement, MovementType } from '../api/types';
import { movementLabel } from '../components/Badges';
import { MovementDialog, type MovementKind } from '../components/MovementDialog';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { number, timeAgo } from '../lib/format';

const quick: { kind: MovementKind; label: string; body: string; icon: typeof ArrowLeftRight }[] = [
  { kind: 'RECEIPT', label: 'Receive goods', body: 'Stock arrived without a purchase order', icon: ArrowDownToLine },
  { kind: 'SALE', label: 'Dispatch', body: 'Goods sold or sent to a customer', icon: ArrowUpFromLine },
  { kind: 'TRANSFER', label: 'Transfer', body: 'Move stock between warehouses', icon: ArrowLeftRight },
  { kind: 'ADJUSTMENT', label: 'Adjust', body: 'Count corrections, damage, expiry', icon: SlidersHorizontal },
];

export default function StockPage() {
  const { allowed } = useAuth();
  const { warehouseId } = useWarehouseScope();
  const [type, setType] = useState<MovementType | ''>('');
  const [dialog, setDialog] = useState<MovementKind | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['movements', warehouseId, type],
    queryFn: () => api.get<Movement[]>(`/stock/movements${qs({ warehouseId, type, limit: 100 })}`),
  });

  return (
    <>
      <PageHeader
        title="Stock moves"
        subtitle="Every change to stock is recorded in a ledger with who did it and why. Daily point-of-sale sales sync automatically and are not listed here."
      />

      {allowed('moveStock') && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quick.map((q) => (
            <button
              key={q.kind}
              onClick={() => setDialog(q.kind)}
              className="group flex items-start gap-3 rounded-[var(--radius-lg)] border border-line bg-surface p-4 text-left transition-colors hover:border-ink"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-concrete text-ink group-hover:bg-ink group-hover:text-white">
                <q.icon size={17} />
              </span>
              <span>
                <span className="block font-semibold">{q.label}</span>
                <span className="block text-[12.5px] text-muted">{q.body}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="px-4 pt-2">
          <Tabs
            value={type}
            onChange={setType}
            items={[
              { value: '', label: 'All moves' },
              { value: 'RECEIPT', label: 'Received' },
              { value: 'SALE', label: 'Dispatched' },
              { value: 'TRANSFER_IN', label: 'Transfers in' },
              { value: 'TRANSFER_OUT', label: 'Transfers out' },
              { value: 'ADJUSTMENT', label: 'Adjustments' },
            ]}
          />
        </div>
        {error ? (
          <div className="p-4"><ErrorState error={error} onRetry={() => refetch()} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[820px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Warehouse</th>
                  <th>Type</th>
                  <th className="text-right">Change</th>
                  <th>Reference</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 8 }, (_, i) => <tr key={i}><td colSpan={7}><Skeleton className="h-6" /></td></tr>)}
                {data?.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-muted" title={new Date(m.createdAt).toLocaleString('en-IN')}>{timeAgo(m.createdAt)}</td>
                    <td>
                      <Link to={`/products/${m.productId}`} className="font-medium hover:underline">{m.productName}</Link>
                      <div className="sku">{m.sku}</div>
                    </td>
                    <td className="text-muted">{m.warehouseName}</td>
                    <td>{movementLabel[m.type]}</td>
                    <td className={clsx('num text-right font-semibold', m.quantity > 0 ? 'text-stock' : 'text-out')}>
                      {m.quantity > 0 ? '+' : '−'}{number(Math.abs(m.quantity))}
                    </td>
                    <td className="max-w-[220px] truncate text-muted">{[m.reference, m.note].filter(Boolean).join(', ') || '—'}</td>
                    <td className="text-muted">{m.userName ?? 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.length === 0 && <EmptyState title="No stock moves yet" body="Receipts, dispatches, transfers and adjustments will be listed here." />}
          </div>
        )}
      </div>

      {dialog && <MovementDialog open onClose={() => setDialog(null)} initialKind={dialog} warehouseId={warehouseId} />}
    </>
  );
}
