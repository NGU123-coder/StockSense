import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, qs } from '../api/client';
import type { POListItem, POStatus } from '../api/types';
import { POBadge } from '../components/Badges';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { date, inr } from '../lib/format';

export default function PurchaseOrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as POStatus | '';
  const navigate = useNavigate();
  const { allowed } = useAuth();
  const { warehouseId } = useWarehouseScope();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['purchase-orders', status, warehouseId, q],
    queryFn: () =>
      api.get<{ items: POListItem[]; counts: Partial<Record<POStatus, number>> }>(
        `/purchase-orders${qs({ status, warehouseId, q })}`,
      ),
  });
  const c = data?.counts ?? {};
  const total = Object.values(c).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Draft, submit for approval, approve, then receive. Receiving adds the goods to stock automatically."
        actions={
          allowed('createPO') && (
            <Link to="/purchase-orders/new" className="btn-primary">
              <Plus size={15} /> New purchase order
            </Link>
          )
        }
      />
      <div className="panel">
        <div className="px-4 pt-2">
          <Tabs
            value={status}
            onChange={(v) => setParams(v ? { status: v } : {}, { replace: true })}
            items={[
              { value: '', label: 'All', count: total },
              { value: 'DRAFT', label: 'Drafts', count: c.DRAFT ?? 0 },
              { value: 'SUBMITTED', label: 'Awaiting approval', count: c.SUBMITTED ?? 0 },
              { value: 'APPROVED', label: 'Approved', count: c.APPROVED ?? 0 },
              { value: 'RECEIVED', label: 'Received', count: c.RECEIVED ?? 0 },
              { value: 'CANCELLED', label: 'Cancelled', count: c.CANCELLED ?? 0 },
            ]}
          />
        </div>
        <div className="border-b border-line px-4 py-3">
          <div className="relative max-w-sm">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9" placeholder="PO number or supplier" aria-label="Search purchase orders" />
          </div>
        </div>
        {error ? (
          <div className="p-4"><ErrorState error={error} onRetry={() => refetch()} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Supplier</th>
                  <th>Deliver to</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Value</th>
                  <th>Expected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 6 }, (_, i) => (
                  <tr key={i}><td colSpan={7}><Skeleton className="h-7" /></td></tr>
                ))}
                {data?.items.map((po) => {
                  const overdue = po.status === 'APPROVED' && po.expectedDate && new Date(po.expectedDate) < new Date();
                  return (
                    <tr key={po.id} className="row-link" onClick={() => navigate(`/purchase-orders/${po.id}`)}>
                      <td>
                        <Link to={`/purchase-orders/${po.id}`} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                          {po.poNumber}
                        </Link>
                        <div className="text-[12px] text-muted">by {po.createdBy ?? 'system'}, {date(po.createdAt)}</div>
                      </td>
                      <td>{po.supplierName}</td>
                      <td className="text-muted">{po.warehouseName}</td>
                      <td className="num text-right">{po.itemCount}</td>
                      <td className="num text-right font-semibold">{inr(po.totalAmount)}</td>
                      <td className={overdue ? 'font-semibold text-out' : 'text-muted'}>
                        {date(po.expectedDate)}
                        {overdue && <div className="text-[11.5px]">Overdue</div>}
                      </td>
                      <td><POBadge status={po.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data?.items.length === 0 && (
              <EmptyState
                title={status ? 'No orders with this status' : 'No purchase orders yet'}
                body="Create one by hand, or let the reorder planner draft them from the forecast."
                action={<Link to="/planner" className="btn-ghost">Open reorder planner</Link>}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
