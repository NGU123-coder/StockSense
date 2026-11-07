import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Skeleton } from './components/ui';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';

// Each page is its own chunk, so the first load only ships what the login screen needs.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const PlannerPage = lazy(() => import('./pages/PlannerPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const PurchaseOrderDetailPage = lazy(() => import('./pages/PurchaseOrderDetailPage'));
const NewPurchaseOrderPage = lazy(() => import('./pages/NewPurchaseOrderPage'));
const StockPage = lazy(() => import('./pages/StockPage'));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage'));
const WarehousesPage = lazy(() => import('./pages/WarehousesPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-1 w-40 overflow-hidden rounded-full bg-line">
          <div className="runway-fill h-full w-full bg-ink" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {[
          ['/', DashboardPage],
          ['/products', ProductsPage],
          ['/products/:id', ProductDetailPage],
          ['/planner', PlannerPage],
          ['/purchase-orders', PurchaseOrdersPage],
          ['/purchase-orders/new', NewPurchaseOrderPage],
          ['/purchase-orders/:id', PurchaseOrderDetailPage],
          ['/stock', StockPage],
          ['/suppliers', SuppliersPage],
          ['/warehouses', WarehousesPage],
          ['/users', UsersPage],
        ].map(([path, Page]) => {
          const P = Page as React.ComponentType;
          return (
            <Route
              key={path as string}
              path={path as string}
              element={
                <Suspense fallback={<PageFallback />}>
                  <P />
                </Suspense>
              }
            />
          );
        })}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
