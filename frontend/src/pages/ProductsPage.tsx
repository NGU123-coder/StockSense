import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Plus, ScanLine, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, qs } from '../api/client';
import { useCategories } from '../api/queries';
import type { ProductList, StockStatus } from '../api/types';
import { StockBadge } from '../components/Badges';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { ProductForm } from '../components/ProductForm';
import { Runway } from '../components/Runway';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { useDebounced } from '../hooks/useDebounced';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { days, inr, number } from '../lib/format';

type Sort = 'name' | 'quantity' | 'value' | 'cover';

export default function ProductsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { allowed } = useAuth();
  const { warehouseId } = useWarehouseScope();
  const { data: categories } = useCategories();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const q = useDebounced(search);

  const status = (params.get('status') ?? '') as StockStatus | '';
  const category = params.get('category') ?? '';
  const sort = (params.get('sort') ?? 'name') as Sort;
  const dir = params.get('dir') ?? 'asc';
  const page = Number(params.get('page') ?? 1);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Keep the URL in sync with the debounced search box (shareable links, back button works).
  useEffect(() => {
    if ((params.get('q') ?? '') !== q) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  // The top-bar search navigates here with ?q=… — reflect external changes in the box.
  const urlQ = params.get('q') ?? '';
  useEffect(() => {
    if (urlQ !== q) setSearch(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['products', { q, status, category, sort, dir, page, warehouseId }],
    queryFn: () =>
      api.get<ProductList>(`/products${qs({ q, status, category, sort, dir, page, pageSize: 20, warehouseId })}`),
    placeholderData: keepPreviousData,
  });

  const counts = data?.statusCounts ?? {};
  const all = (counts.ok ?? 0) + (counts.low ?? 0) + (counts.out ?? 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const SortHead = ({ col, children, className }: { col: Sort; children: React.ReactNode; className?: string }) => (
    <th className={className} aria-sort={sort === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        className="inline-flex items-center gap-1 hover:text-ink"
        onClick={() => update({ sort: col, dir: sort === col && dir === 'asc' ? 'desc' : 'asc' })}
      >
        {children}
        {sort === col && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Stock on hand against each item's reorder point. Bars turn amber when it is time to order."
        actions={
          allowed('manageCatalog') && (
            <button className="btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add product
            </button>
          )
        }
      />

      <div className="panel">
        <div className="px-4 pt-2">
          <Tabs
            value={status}
            onChange={(v) => update({ status: v || null })}
            items={[
              { value: '', label: 'All', count: all },
              { value: 'low', label: 'Needs reorder', count: counts.low ?? 0 },
              { value: 'out', label: 'Out of stock', count: counts.out ?? 0 },
              { value: 'ok', label: 'Healthy', count: counts.ok ?? 0 },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
              placeholder="Name, SKU or barcode"
              aria-label="Search products"
            />
          </div>
          <select
            value={category}
            onChange={(e) => update({ category: e.target.value || null })}
            className="input w-auto min-w-[160px]"
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button className="btn-ghost" onClick={() => setScanning(true)}>
            <ScanLine size={15} /> Scan
          </button>
        </div>

        {error ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : (
          <div className={clsx('overflow-x-auto transition-opacity', isFetching && !isLoading && 'opacity-60')}>
            <table className="table min-w-[860px]">
              <thead>
                <tr>
                  <SortHead col="name">Product</SortHead>
                  <th>Supplier</th>
                  <SortHead col="quantity" className="w-[26%]">
                    Stock vs reorder point
                  </SortHead>
                  <SortHead col="cover" className="text-right">
                    Cover
                  </SortHead>
                  <SortHead col="value" className="text-right">
                    Value
                  </SortHead>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 8 }, (_, i) => (
                    <tr key={i}>
                      <td colSpan={6}>
                        <Skeleton className="h-8" />
                      </td>
                    </tr>
                  ))}
                {data?.items.map((p) => (
                  <tr key={p.id} className="row-link" onClick={() => navigate(`/products/${p.id}`)}>
                    <td>
                      <Link to={`/products/${p.id}`} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <div className="flex gap-2">
                        <span className="sku">{p.sku}</span>
                        <span className="text-[12px] text-faint">{p.category}</span>
                      </div>
                    </td>
                    <td className="text-muted">{p.supplierName ?? '—'}</td>
                    <td>
                      <Runway quantity={p.quantity} reorderPoint={p.reorderPoint} />
                      <p className="num mt-1 text-[11.5px] text-muted">
                        {number(p.quantity)} {p.unit} <span className="text-faint">/ reorder at {number(p.reorderPoint)}</span>
                      </p>
                    </td>
                    <td className="num text-right">{days(p.daysOfCover)}</td>
                    <td className="num text-right">{inr(p.stockValue)}</td>
                    <td>
                      <StockBadge
                        status={p.status}
                        detail={
                          p.status === 'low' && !warehouseId && p.warehouseCount > 1
                            ? `Low in ${p.lowWarehouses} of ${p.warehouseCount}`
                            : undefined
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data && data.items.length === 0 && (
              <EmptyState
                title="No products match these filters"
                body="Try a different search term, or clear the status and category filters."
                action={
                  <button className="btn-ghost" onClick={() => { setSearch(''); setParams({}); }}>
                    Clear filters
                  </button>
                }
              />
            )}
          </div>
        )}

        {data && data.total > data.pageSize && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
            <span className="text-muted">
              {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost h-8" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                Previous
              </button>
              <button className="btn-ghost h-8" disabled={page >= pages} onClick={() => update({ page: String(page + 1) })}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <ProductForm open={adding} onClose={() => setAdding(false)} />
      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        onDetected={(code) => {
          setScanning(false);
          api
            .get<{ id: string }>(`/products/lookup?code=${encodeURIComponent(code)}`)
            .then((p) => navigate(`/products/${p.id}`))
            .catch(() => setSearch(code));
        }}
      />
    </>
  );
}
