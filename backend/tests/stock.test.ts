import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { db, pool } from '../src/db/client';
import { alerts, stockLevels } from '../src/db/schema';
import { closeRedis } from '../src/lib/redis';
import { app, auth, resetDb, tokenFor } from './helpers';

let fx: Awaited<ReturnType<typeof resetDb>>;
let manager: string;

beforeAll(async () => {
  fx = await resetDb();
  manager = await tokenFor('MANAGER');
});
afterAll(async () => {
  await closeRedis();
  await pool.end();
});

const qty = async (productId: string, warehouseId: string) =>
  (
    await db
      .select({ q: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)))
  )[0]?.q;

describe('stock movements', () => {
  it('records a sale and reduces stock', async () => {
    const res = await request(app)
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ productId: fx.tea.id, warehouseId: fx.kol.id, type: 'SALE', quantity: 15 });
    expect(res.status).toBe(201);
    expect(res.body.newQty).toBe(85);
    expect(await qty(fx.tea.id, fx.kol.id)).toBe(85);
  });

  it('refuses to sell more than is in stock', async () => {
    const res = await request(app)
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ productId: fx.tea.id, warehouseId: fx.kol.id, type: 'SALE', quantity: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Not enough stock/);
    expect(await qty(fx.tea.id, fx.kol.id)).toBe(85);
  });

  it('never oversells under concurrent requests (row locking)', async () => {
    // 10 parallel sales of 10 units against 50 in stock: exactly 5 must succeed.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/stock/movements')
          .set(auth(manager))
          .send({ productId: fx.rice.id, warehouseId: fx.kol.id, type: 'SALE', quantity: 10 }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await qty(fx.rice.id, fx.kol.id)).toBe(0);
  });

  it('opens an OUT_OF_STOCK alert at zero and resolves it after a receipt', async () => {
    const open = await db.select().from(alerts).where(eq(alerts.productId, fx.rice.id));
    expect(open.some((a) => a.type === 'OUT_OF_STOCK' && a.resolvedAt === null)).toBe(true);

    await request(app)
      .post('/api/stock/movements')
      .set(auth(manager))
      .send({ productId: fx.rice.id, warehouseId: fx.kol.id, type: 'RECEIPT', quantity: 100 });
    const after = await db.select().from(alerts).where(eq(alerts.productId, fx.rice.id));
    expect(after.filter((a) => a.warehouseId === fx.kol.id && a.resolvedAt === null)).toHaveLength(0);
  });

  it('transfers stock between warehouses atomically', async () => {
    const res = await request(app)
      .post('/api/stock/transfers')
      .set(auth(manager))
      .send({ productId: fx.rice.id, fromWarehouseId: fx.kol.id, toWarehouseId: fx.mum.id, quantity: 30 });
    expect(res.status).toBe(201);
    expect(await qty(fx.rice.id, fx.kol.id)).toBe(70);
    expect(await qty(fx.rice.id, fx.mum.id)).toBe(40);

    const tooMuch = await request(app)
      .post('/api/stock/transfers')
      .set(auth(manager))
      .send({ productId: fx.rice.id, fromWarehouseId: fx.kol.id, toWarehouseId: fx.mum.id, quantity: 999 });
    expect(tooMuch.status).toBe(409);
    // Neither side changed.
    expect(await qty(fx.rice.id, fx.kol.id)).toBe(70);
    expect(await qty(fx.rice.id, fx.mum.id)).toBe(40);
  });

  it('does not let viewers move stock', async () => {
    const viewer = await tokenFor('VIEWER');
    const res = await request(app)
      .post('/api/stock/movements')
      .set(auth(viewer))
      .send({ productId: fx.tea.id, warehouseId: fx.kol.id, type: 'RECEIPT', quantity: 5 });
    expect(res.status).toBe(403);
  });
});

describe('products', () => {
  it('searches by name, SKU or barcode and reports per-warehouse status', async () => {
    const res = await request(app).get('/api/products?q=8901234100011').set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].sku).toBe('RICE-5');
  });

  it('looks up a product by barcode for the scanner', async () => {
    const res = await request(app).get('/api/products/lookup?code=8901234100011').set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.body.sku).toBe('RICE-5');
    expect((await request(app).get('/api/products/lookup?code=000').set(auth(manager))).status).toBe(404);
  });

  it('creates a product with an auto-generated valid EAN-13 barcode', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(manager))
      .send({ sku: 'oil-1', name: 'Sunflower Oil 1 L', category: 'Staples', costPrice: 120, sellPrice: 150 });
    expect(res.status).toBe(201);
    expect(res.body.sku).toBe('OIL-1');
    expect(res.body.barcode).toMatch(/^890\d{10}$/);
  });

  it('rejects duplicate SKUs with 409', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth(manager))
      .send({ sku: 'RICE-5', name: 'Dup', category: 'Staples', costPrice: 1, sellPrice: 2 });
    expect(res.status).toBe(409);
  });
});
