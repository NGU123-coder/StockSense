import bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app';
import { db } from '../src/db/client';
import { products, stockLevels, suppliers, users, warehouses, type Role } from '../src/db/schema';

export const app = createApp();
export const PASSWORD = 'Test@1234';

/** Fresh, minimal fixture: one user per role, two warehouses, one supplier, two products. */
export async function resetDb() {
  await db.execute(sql`truncate table alerts, forecasts, purchase_order_items, purchase_orders, stock_movements,
    stock_levels, products, suppliers, warehouses, refresh_tokens, users restart identity cascade`);
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const roles: Role[] = ['ADMIN', 'MANAGER', 'PURCHASER', 'VIEWER'];
  await db
    .insert(users)
    .values(
      roles.map((role) => ({ name: `${role} User`, email: `${role.toLowerCase()}@test.in`, role, passwordHash })),
    );
  const [kol, mum] = await db
    .insert(warehouses)
    .values([
      { code: 'KOL', name: 'Kolkata Hub', city: 'Kolkata' },
      { code: 'MUM', name: 'Mumbai DC', city: 'Mumbai' },
    ])
    .returning();
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: 'Test Supplier', email: 'orders@supplier.test', leadTimeDays: 5 })
    .returning();
  const [rice, tea] = await db
    .insert(products)
    .values([
      {
        sku: 'RICE-5',
        barcode: '8901234100011',
        name: 'Rice 5 kg',
        category: 'Staples',
        costPrice: 500,
        sellPrice: 650,
        supplierId: supplier.id,
      },
      {
        sku: 'TEA-500',
        name: 'Tea 500 g',
        category: 'Beverages',
        costPrice: 200,
        sellPrice: 260,
        supplierId: supplier.id,
      },
    ])
    .returning();
  await db.insert(stockLevels).values([
    { productId: rice.id, warehouseId: kol.id, quantity: 50, reorderPoint: 20 },
    { productId: rice.id, warehouseId: mum.id, quantity: 10, reorderPoint: 20 },
    { productId: tea.id, warehouseId: kol.id, quantity: 100, reorderPoint: 30 },
  ]);
  return { kol, mum, supplier, rice, tea };
}

export async function tokenFor(role: Role) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: `${role.toLowerCase()}@test.in`, password: PASSWORD });
  return res.body.accessToken as string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
