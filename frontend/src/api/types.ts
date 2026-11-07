export type Role = 'ADMIN' | 'MANAGER' | 'PURCHASER' | 'VIEWER';
export type StockStatus = 'ok' | 'low' | 'out';
export type POStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RECEIVED' | 'CANCELLED';
export type MovementType = 'RECEIPT' | 'SALE' | 'ADJUSTMENT' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string | null;
  skuCount: number;
  totalUnits: number;
  stockValue: number;
  lowStockCount: number;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  leadTimeDays: number;
  productCount: number;
  openPoCount: number;
  openPoValue: number;
}

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  costPrice: number;
  sellPrice: number;
  supplierId: string | null;
  supplierName: string | null;
  quantity: number;
  reorderPoint: number;
  status: StockStatus;
  lowWarehouses: number;
  warehouseCount: number;
  stockValue: number;
  avgDailyDemand: number;
  daysOfCover: number | null;
  recommendedOrderQty: number;
}

export interface ProductList {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Partial<Record<StockStatus, number>>;
}

export interface WarehouseForecast {
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDays: number;
  recommendedOrderQty: number;
  daysOfCover: number | null;
  stockoutDate: string | null;
  excessQty: number;
  mape: number | null;
  model: string;
  generatedAt: string;
}

export interface ProductDetail {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  costPrice: number;
  sellPrice: number;
  supplierId: string | null;
  isActive: boolean;
  supplier: { id: string; name: string; leadTimeDays: number; email: string | null } | null;
  stock: {
    warehouseId: string;
    warehouseName: string;
    warehouseCode: string;
    quantity: number;
    reorderPoint: number;
    safetyStock: number;
    forecast: WarehouseForecast | null;
  }[];
  openOrders: {
    poId: string;
    poNumber: string;
    status: POStatus;
    warehouseId: string;
    quantity: number;
    expectedDate: string | null;
  }[];
}

export interface Movement {
  id: string;
  type: MovementType;
  quantity: number;
  reference: string | null;
  note: string | null;
  createdAt: string;
  productId?: string;
  productName?: string;
  sku?: string;
  warehouseName: string;
  userName: string | null;
}

export interface Recommendation {
  productId: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  costPrice: number;
  supplierId: string | null;
  supplierName: string | null;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  onHand: number;
  onOrder: number;
  reorderPoint: number;
  safetyStock: number;
  avgDailyDemand: number;
  leadTimeDays: number;
  daysOfCover: number | null;
  stockoutDate: string | null;
  recommendedOrderQty: number;
  orderValue: number;
  excessQty: number;
  excessValue: number;
  revenueAtRisk: number;
  mape: number | null;
  model: string;
}

export interface POListItem {
  id: string;
  poNumber: string;
  status: POStatus;
  totalAmount: number;
  expectedDate: string | null;
  createdAt: string;
  supplierName: string;
  warehouseName: string;
  createdBy: string | null;
  itemCount: number;
}

export interface PODetail {
  id: string;
  poNumber: string;
  status: POStatus;
  totalAmount: number;
  expectedDate: string | null;
  notes: string | null;
  createdAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  receivedAt: string | null;
  supplier: { id: string; name: string; email: string | null; contactName: string | null; phone: string | null; leadTimeDays: number };
  warehouse: { id: string; name: string; code: string; city: string };
  createdBy: string | null;
  approvedBy: string | null;
  items: { id: string; productId: string; sku: string; name: string; unit: string; quantity: number; unitCost: number }[];
  allowedTransitions: POStatus[];
}

export interface Alert {
  id: string;
  type: 'LOW_STOCK' | 'OUT_OF_STOCK';
  message: string;
  createdAt: string;
  productId: string;
  productName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
}

export interface DashboardSummary {
  kpis: {
    stockValue: number;
    totalUnits: number;
    skuCount: number;
    lowStock: number;
    outOfStock: number;
    revenue30d: number;
    revenuePrev30d: number;
    units30d: number;
    unitsPrev30d: number;
    overstockValue: number;
    revenueAtRisk: number;
    reorderValue: number;
    reorderItems: number;
    avgMape: number | null;
    forecastGeneratedAt: string | null;
    openPoCount: number;
    openPoValue: number;
    pendingApproval: number;
    overduePos: number;
  };
  salesTrend: { date: string; revenue: number; units: number }[];
  valueByWarehouse: { id: string; name: string; code: string; value: number }[];
  valueByCategory: { category: string; value: number }[];
  topMovers: { id: string; name: string; sku: string; units: number; change: number | null }[];
  needsAttention: {
    productId: string;
    name: string;
    sku: string;
    warehouseName: string;
    warehouseCode: string;
    quantity: number;
    reorderPoint: number;
    daysOfCover: number | null;
    recommendedOrderQty: number;
    stockoutDate: string | null;
  }[];
  recentActivity: (Movement & { productId: string; productName: string })[];
}

export interface ForecastStatus {
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  serviceHealthy: boolean;
  avgMape: number | null;
  series: number;
}
