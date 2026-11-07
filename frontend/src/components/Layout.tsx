import clsx from 'clsx';
import {
  ArrowLeftRight,
  Bell,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  ScanLine,
  Search,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Warehouse as WarehouseIcon,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAlerts, useWarehouses } from '../api/queries';
import { api } from '../api/client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { useLiveUpdates } from '../hooks/useLiveUpdates';
import { useWarehouseScope } from '../hooks/useWarehouseScope';
import { timeAgo } from '../lib/format';
import { roleLabel, type Permission } from '../lib/roles';
import { BarcodeScanner } from './BarcodeScanner';

const nav: { to: string; label: string; icon: typeof Boxes; perm?: Permission; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/planner', label: 'Reorder planner', icon: TrendingUp },
  { to: '/purchase-orders', label: 'Purchase orders', icon: ShoppingCart },
  { to: '/stock', label: 'Stock moves', icon: ArrowLeftRight },
  { to: '/suppliers', label: 'Suppliers', icon: Truck },
  { to: '/warehouses', label: 'Warehouses', icon: WarehouseIcon },
  { to: '/users', label: 'Team', icon: Users, perm: 'manageUsers' },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#F3F5F4" />
        <rect x="7" y="18" width="5" height="7" rx="1" fill="#14213D" />
        <rect x="13.5" y="13" width="5" height="12" rx="1" fill="#14213D" />
        <rect x="20" y="8" width="5" height="17" rx="1" fill="#E8A317" />
      </svg>
      <span className="font-wide text-[17px] font-[800] tracking-tight text-white">StockSense</span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, allowed, logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-ink px-3 py-5 text-white/80">
      <Logo />
      <nav className="mt-8 flex flex-1 flex-col gap-0.5" aria-label="Main">
        {nav
          .filter((n) => !n.perm || allowed(n.perm))
          .map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-[13.5px] font-medium transition-colors',
                  isActive ? 'bg-white/12 text-white' : 'hover:bg-white/6 hover:text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} className={isActive ? 'text-signal' : 'text-white/55'} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
      </nav>
      <div className="mt-4 border-t border-white/10 px-2 pt-4">
        <p className="truncate text-[13px] font-semibold text-white">{user?.name}</p>
        <p className="text-[12px] text-white/55">{user && roleLabel[user.role]}</p>
        <button
          onClick={() => void logout()}
          className="mt-3 flex items-center gap-2 text-[12.5px] text-white/60 hover:text-white"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

function WarehouseSwitcher() {
  const { data } = useWarehouses();
  const { warehouseId, setWarehouseId } = useWarehouseScope();
  // Forget a stored warehouse that no longer exists.
  useEffect(() => {
    if (data && warehouseId && !data.some((w) => w.id === warehouseId)) setWarehouseId(null);
  }, [data, warehouseId, setWarehouseId]);
  return (
    <label className="relative flex items-center">
      <WarehouseIcon size={15} className="pointer-events-none absolute left-3 text-muted" />
      <span className="sr-only">Warehouse</span>
      <select
        value={warehouseId ?? ''}
        onChange={(e) => setWarehouseId(e.target.value || null)}
        className="input h-9 w-[190px] cursor-pointer appearance-none pr-8 pl-9 font-semibold"
      >
        <option value="">All warehouses</option>
        {data?.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 text-muted" width="10" height="6" viewBox="0 0 10 6" aria-hidden>
        <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
    </label>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [scanning, setScanning] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/products?q=${encodeURIComponent(q.trim())}`);
  };
  const onScan = async (code: string) => {
    setScanning(false);
    try {
      const p = await qc.fetchQuery({ queryKey: ['lookup', code], queryFn: () => api.get<{ id: string }>(`/products/lookup?code=${encodeURIComponent(code)}`) });
      navigate(`/products/${p.id}`);
    } catch {
      navigate(`/products?q=${encodeURIComponent(code)}`);
    }
  };
  return (
    <>
      <form onSubmit={submit} className="relative hidden flex-1 md:block md:max-w-[420px]" role="search">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="input pr-10 pl-9"
          placeholder="Search products by name, SKU or barcode"
          aria-label="Search products"
        />
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1.5 text-muted hover:bg-concrete hover:text-ink"
          title="Scan a barcode"
          aria-label="Scan a barcode"
        >
          <ScanLine size={16} />
        </button>
      </form>
      <button className="btn-ghost px-2.5 md:hidden" onClick={() => setScanning(true)} aria-label="Scan a barcode">
        <ScanLine size={16} />
      </button>
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onDetected={onScan} />
    </>
  );
}

function AlertsBell() {
  const { data } = useAlerts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const count = data?.length ?? 0;
  const dismiss = async (id: string) => {
    await api.post(`/alerts/${id}/dismiss`);
    qc.invalidateQueries({ queryKey: ['alerts'] });
  };
  return (
    <div className="relative" ref={ref}>
      <button
        className="btn-ghost relative px-2.5"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${count} open alerts`}
        aria-expanded={open}
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="num absolute -top-1.5 -right-1.5 min-w-[18px] rounded-full bg-signal px-1 text-[11px] leading-[18px] font-bold text-ink">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[0_20px_50px_-20px_rgba(20,33,61,.35)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="section-title">Stock alerts</p>
            <span className="text-[12px] text-muted">{count} open</span>
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {count === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">Nothing needs attention.</li>}
            {data?.map((a) => (
              <li key={a.id} className="group flex gap-3 border-b border-line px-4 py-3 last:border-0">
                <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', a.type === 'OUT_OF_STOCK' ? 'bg-out' : 'bg-signal')} />
                <div className="min-w-0 flex-1">
                  <Link to={`/products/${a.productId}`} onClick={() => setOpen(false)} className="block text-[13px] font-semibold hover:underline">
                    {a.productName}
                  </Link>
                  <p className="text-[12px] text-muted">
                    {a.type === 'OUT_OF_STOCK' ? 'Out of stock' : 'Below reorder point'} at {a.warehouseName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">{timeAgo(a.createdAt)}</p>
                </div>
                <button
                  onClick={() => void dismiss(a.id)}
                  className="self-start rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-concrete hover:text-ink focus:opacity-100"
                  aria-label="Dismiss alert"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <Link
            to="/planner"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 border-t border-line bg-concrete/60 px-4 py-2.5 text-[13px] font-semibold hover:bg-concrete"
          >
            <ClipboardList size={15} /> Open reorder planner
          </Link>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  useLiveUpdates(!!user);
  useEffect(() => setMobileNav(false), [location.pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">
        <Sidebar />
      </aside>

      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setMobileNav(false)} />
          <div className="absolute inset-y-0 left-0 w-[250px]">
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-line bg-concrete/90 px-4 backdrop-blur md:px-8">
          <button className="btn-ghost px-2.5 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
            <Menu size={16} />
          </button>
          <WarehouseSwitcher />
          <div className="flex flex-1 justify-end gap-2 md:justify-between">
            <GlobalSearch />
            <AlertsBell />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-7 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
