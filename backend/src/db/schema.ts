/**
 * StockSense database schema (PostgreSQL, Drizzle ORM).
 *
 * Design notes
 * - stock_levels holds the CURRENT quantity per product per warehouse.
 * - stock_movements is an append-only ledger of every change (signed quantity).
 *   stock_levels can always be rebuilt from it, and the forecasting service
 *   reads SALE movements from it as demand history.
 * - Money is stored as NUMERIC, never floating point.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['ADMIN', 'MANAGER', 'PURCHASER', 'VIEWER']);
export const movementTypeEnum = pgEnum('movement_type', [
  'RECEIPT',
  'SALE',
  'ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]);
export const poStatusEnum = pgEnum('po_status', ['DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'CANCELLED']);
export const alertTypeEnum = pgEnum('alert_type', ['LOW_STOCK', 'OUT_OF_STOCK']);

/** Human-friendly purchase order numbers (PO-2026-01001) without race conditions. */
export const poNumberSeq = pgSequence('po_number_seq', { startWith: 1001 });

const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: roleEnum('role').notNull().default('VIEWER'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: createdAt(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  city: text('city').notNull(),
  address: text('address'),
  createdAt: createdAt(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  city: text('city'),
  leadTimeDays: integer('lead_time_days').notNull().default(7),
  createdAt: createdAt(),
});

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull().unique(),
    barcode: text('barcode').unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    unit: text('unit').notNull().default('pcs'),
    costPrice: money('cost_price').notNull(),
    sellPrice: money('sell_price').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('products_category_idx').on(t.category)],
);

export const stockLevels = pgTable(
  'stock_levels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    reorderPoint: integer('reorder_point').notNull().default(0),
    safetyStock: integer('safety_stock').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('stock_levels_product_warehouse_uq').on(t.productId, t.warehouseId),
    // The database itself refuses negative stock, even if application code has a bug.
    check('stock_levels_quantity_non_negative', sql`${t.quantity} >= 0`),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    type: movementTypeEnum('type').notNull(),
    quantity: integer('quantity').notNull(), // signed: + in, - out
    reference: text('reference'),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('movements_product_wh_date_idx').on(t.productId, t.warehouseId, t.createdAt),
    index('movements_type_date_idx').on(t.type, t.createdAt),
  ],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    poNumber: text('po_number').notNull().unique(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: poStatusEnum('status').notNull().default('DRAFT'),
    expectedDate: timestamp('expected_date', { withTimezone: true }),
    notes: text('notes'),
    totalAmount: money('total_amount').notNull().default(0),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    approvedById: uuid('approved_by_id').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('po_status_idx').on(t.status)],
);

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id')
    .notNull()
    .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  quantity: integer('quantity').notNull(),
  unitCost: money('unit_cost').notNull(),
});

export const forecasts = pgTable(
  'forecasts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    avgDailyDemand: doublePrecision('avg_daily_demand').notNull(),
    demandStdDev: doublePrecision('demand_std_dev').notNull(),
    leadTimeDays: integer('lead_time_days').notNull(),
    safetyStock: integer('safety_stock').notNull(),
    reorderPoint: integer('reorder_point').notNull(),
    recommendedOrderQty: integer('recommended_order_qty').notNull(),
    onHand: integer('on_hand').notNull().default(0),
    onOrder: integer('on_order').notNull().default(0),
    daysOfCover: doublePrecision('days_of_cover'),
    stockoutDate: timestamp('stockout_date', { withTimezone: true }),
    excessQty: integer('excess_qty').notNull().default(0),
    mape: doublePrecision('mape'),
    mae: doublePrecision('mae'),
    series: jsonb('series').$type<{ date: string; qty: number; lower: number; upper: number }[]>().notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('forecasts_product_warehouse_uq').on(t.productId, t.warehouseId)],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: alertTypeEnum('type').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('alerts_open_idx').on(t.resolvedAt)],
);

/* ---------------------------- Relations ---------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  movements: many(stockMovements),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  stockLevels: many(stockLevels),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  products: many(products),
  purchaseOrders: many(purchaseOrders),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [products.supplierId], references: [suppliers.id] }),
  stockLevels: many(stockLevels),
  forecasts: many(forecasts),
}));

export const stockLevelsRelations = relations(stockLevels, ({ one }) => ({
  product: one(products, { fields: [stockLevels.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockLevels.warehouseId], references: [warehouses.id] }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, { fields: [stockMovements.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [stockMovements.warehouseId], references: [warehouses.id] }),
  user: one(users, { fields: [stockMovements.userId], references: [users.id] }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  warehouse: one(warehouses, { fields: [purchaseOrders.warehouseId], references: [warehouses.id] }),
  createdBy: one(users, { fields: [purchaseOrders.createdById], references: [users.id] }),
  approvedBy: one(users, { fields: [purchaseOrders.approvedById], references: [users.id] }),
  items: many(purchaseOrderItems),
}));

export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderItems.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  product: one(products, { fields: [purchaseOrderItems.productId], references: [products.id] }),
}));

export const forecastsRelations = relations(forecasts, ({ one }) => ({
  product: one(products, { fields: [forecasts.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [forecasts.warehouseId], references: [warehouses.id] }),
}));

export const alertsRelations = relations(alerts, ({ one }) => ({
  product: one(products, { fields: [alerts.productId], references: [products.id] }),
  warehouse: one(warehouses, { fields: [alerts.warehouseId], references: [warehouses.id] }),
}));

export type Role = (typeof roleEnum.enumValues)[number];
export type MovementType = (typeof movementTypeEnum.enumValues)[number];
export type POStatus = (typeof poStatusEnum.enumValues)[number];
