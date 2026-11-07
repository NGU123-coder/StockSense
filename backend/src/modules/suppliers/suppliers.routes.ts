import { asc, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { products, purchaseOrders, suppliers } from '../../db/schema';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { notFound } from '../../utils/httpError';

export const suppliersRouter = Router();

suppliersRouter.get('/', async (_req, res) => {
  const productCount = db
    .select({ supplierId: products.supplierId, n: sql<number>`count(*)`.as('n') })
    .from(products)
    .groupBy(products.supplierId)
    .as('pc');
  const openPos = db
    .select({
      supplierId: purchaseOrders.supplierId,
      n: sql<number>`count(*)`.as('open_n'),
      value: sql<number>`sum(${purchaseOrders.totalAmount})`.as('open_value'),
    })
    .from(purchaseOrders)
    .where(sql`${purchaseOrders.status} in ('SUBMITTED','APPROVED')`)
    .groupBy(purchaseOrders.supplierId)
    .as('op');

  const rows = await db
    .select({
      ...getSupplierCols(),
      productCount: sql<number>`coalesce(${productCount.n}, 0)`.mapWith(Number),
      openPoCount: sql<number>`coalesce(${openPos.n}, 0)`.mapWith(Number),
      openPoValue: sql<number>`coalesce(${openPos.value}, 0)`.mapWith(Number),
    })
    .from(suppliers)
    .leftJoin(productCount, eq(productCount.supplierId, suppliers.id))
    .leftJoin(openPos, eq(openPos.supplierId, suppliers.id))
    .orderBy(asc(suppliers.name));
  res.json(rows);
});

function getSupplierCols() {
  return {
    id: suppliers.id,
    name: suppliers.name,
    contactName: suppliers.contactName,
    email: suppliers.email,
    phone: suppliers.phone,
    city: suppliers.city,
    leadTimeDays: suppliers.leadTimeDays,
    createdAt: suppliers.createdAt,
  };
}

suppliersRouter.get('/:id', async (req, res) => {
  const id = req.params.id as string;
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, id));
  if (!supplier) throw notFound('Supplier');
  const [items, orders] = await Promise.all([
    db
      .select({ id: products.id, sku: products.sku, name: products.name, costPrice: products.costPrice })
      .from(products)
      .where(eq(products.supplierId, id))
      .orderBy(asc(products.name)),
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.supplierId, id))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(10),
  ]);
  res.json({ ...supplier, products: items, recentOrders: orders });
});

const SupplierBody = z.object({
  name: z.string().trim().min(2),
  contactName: z.string().trim().optional().nullable(),
  email: z
    .email()
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  phone: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  leadTimeDays: z.coerce.number().int().min(1).max(120),
});

suppliersRouter.post('/', authorize(...can.manageSuppliers), validate({ body: SupplierBody }), async (req, res) => {
  const [s] = await db.insert(suppliers).values(req.body).returning();
  res.status(201).json(s);
});

suppliersRouter.patch(
  '/:id',
  authorize(...can.manageSuppliers),
  validate({ body: SupplierBody.partial() }),
  async (req, res) => {
    const [s] = await db
      .update(suppliers)
      .set(req.body)
      .where(eq(suppliers.id, req.params.id as string))
      .returning();
    if (!s) throw notFound('Supplier');
    res.json(s);
  },
);
