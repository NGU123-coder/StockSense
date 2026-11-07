import request from 'supertest';
import { pool } from '../src/db/client';
import { assertTransition } from '../src/modules/purchase-orders/po.service';
import { closeRedis } from '../src/lib/redis';
import { app, auth, resetDb, tokenFor } from './helpers';

let fx: Awaited<ReturnType<typeof resetDb>>;
let purchaser: string;
let manager: string;

beforeAll(async () => {
  fx = await resetDb();
  purchaser = await tokenFor('PURCHASER');
  manager = await tokenFor('MANAGER');
});
afterAll(async () => {
  await closeRedis();
  await pool.end();
});

describe('purchase order state machine', () => {
  it('allows only valid transitions', () => {
    expect(() => assertTransition('DRAFT', 'SUBMITTED')).not.toThrow();
    expect(() => assertTransition('DRAFT', 'RECEIVED')).toThrow();
    expect(() => assertTransition('RECEIVED', 'CANCELLED')).toThrow();
  });
});

describe('purchase order workflow', () => {
  let poId: string;

  it('creates a draft with a sequential PO number and computed total', async () => {
    const res = await request(app)
      .post('/api/purchase-orders')
      .set(auth(purchaser))
      .send({
        supplierId: fx.supplier.id,
        warehouseId: fx.mum.id,
        items: [
          { productId: fx.rice.id, quantity: 40 },
          { productId: fx.tea.id, quantity: 10, unitCost: 190 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.poNumber).toMatch(/^PO-\d{4}-\d{5}$/);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.totalAmount).toBe(40 * 500 + 10 * 190);
    expect(res.body.allowedTransitions).toEqual(['SUBMITTED', 'CANCELLED']);
    poId = res.body.id;
  });

  it('purchaser submits, but cannot approve', async () => {
    expect((await request(app).post(`/api/purchase-orders/${poId}/submit`).set(auth(purchaser))).body.status).toBe(
      'SUBMITTED',
    );
    expect((await request(app).post(`/api/purchase-orders/${poId}/approve`).set(auth(purchaser))).status).toBe(403);
  });

  it('cannot be received before approval', async () => {
    const res = await request(app).post(`/api/purchase-orders/${poId}/receive`).set(auth(manager));
    expect(res.status).toBe(409);
  });

  it('manager approves and receives; stock increases by the ordered quantity', async () => {
    const approved = await request(app).post(`/api/purchase-orders/${poId}/approve`).set(auth(manager));
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedBy).toBe('MANAGER User');

    const received = await request(app).post(`/api/purchase-orders/${poId}/receive`).set(auth(manager));
    expect(received.body.status).toBe('RECEIVED');

    const product = await request(app).get(`/api/products/${fx.rice.id}`).set(auth(manager));
    const mum = product.body.stock.find((s: { warehouseCode: string }) => s.warehouseCode === 'MUM');
    expect(mum.quantity).toBe(10 + 40);
  });

  it('cannot be received twice', async () => {
    const res = await request(app).post(`/api/purchase-orders/${poId}/receive`).set(auth(manager));
    expect(res.status).toBe(409);
  });

  it('renders a PDF', async () => {
    const res = await request(app).get(`/api/purchase-orders/${poId}/pdf`).set(auth(manager));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
