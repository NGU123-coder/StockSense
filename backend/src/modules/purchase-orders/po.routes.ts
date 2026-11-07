import { aliasedTable, and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import {
  poStatusEnum,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
  users,
  warehouses,
} from '../../db/schema';
import { sendMail } from '../../lib/mailer';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, notFound } from '../../utils/httpError';
import { renderPoPdf } from './po.pdf';
import { createFromRecommendations, createPurchaseOrder, PO_TRANSITIONS, transition, updateDraft } from './po.service';

export const poRouter = Router();

const approver = aliasedTable(users, 'approver');

const ListQuery = z.object({
  status: z.enum(poStatusEnum.enumValues).optional(),
  supplierId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  q: z.string().trim().optional(),
});

poRouter.get('/', validate({ query: ListQuery }), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof ListQuery>;
  const filters: (SQL | undefined)[] = [
    q.status ? eq(purchaseOrders.status, q.status) : undefined,
    q.supplierId ? eq(purchaseOrders.supplierId, q.supplierId) : undefined,
    q.warehouseId ? eq(purchaseOrders.warehouseId, q.warehouseId) : undefined,
    q.q ? or(ilike(purchaseOrders.poNumber, `%${q.q}%`), ilike(suppliers.name, `%${q.q}%`)) : undefined,
  ];
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: purchaseOrders.id,
        poNumber: purchaseOrders.poNumber,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        expectedDate: purchaseOrders.expectedDate,
        createdAt: purchaseOrders.createdAt,
        supplierName: suppliers.name,
        warehouseName: warehouses.name,
        createdBy: users.name,
        itemCount:
          sql<number>`(select count(*) from purchase_order_items i where i.purchase_order_id = ${purchaseOrders.id})`.mapWith(
            Number,
          ),
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .leftJoin(users, eq(users.id, purchaseOrders.createdById))
      .where(and(...filters))
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(200),
    db
      .select({ status: purchaseOrders.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(purchaseOrders)
      .groupBy(purchaseOrders.status),
  ]);
  res.json({ items: rows, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) });
});

async function loadPo(id: string) {
  const [po] = await db
    .select({
      po: purchaseOrders,
      supplier: suppliers,
      warehouse: warehouses,
      createdBy: users.name,
      approvedBy: approver.name,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdById))
    .leftJoin(approver, eq(approver.id, purchaseOrders.approvedById))
    .where(eq(purchaseOrders.id, id));
  if (!po) throw notFound('Purchase order');
  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productId: products.id,
      sku: products.sku,
      name: products.name,
      unit: products.unit,
      quantity: purchaseOrderItems.quantity,
      unitCost: purchaseOrderItems.unitCost,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(asc(products.name));
  return {
    ...po.po,
    supplier: po.supplier,
    warehouse: po.warehouse,
    createdBy: po.createdBy,
    approvedBy: po.approvedBy,
    items,
    allowedTransitions: PO_TRANSITIONS[po.po.status],
  };
}

poRouter.get('/:id', async (req, res) => {
  res.json(await loadPo(req.params.id as string));
});

const ItemSchema = z.object({
  productId: z.uuid(),
  quantity: z.coerce.number().int().positive(),
  unitCost: z.coerce.number().positive().optional(),
});

const CreateBody = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  expectedDate: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(ItemSchema).min(1, 'Add at least one item'),
});

poRouter.post('/', authorize(...can.createPO), validate({ body: CreateBody }), async (req, res) => {
  const po = await createPurchaseOrder({ ...req.body, userId: req.user!.id });
  res.status(201).json(await loadPo(po.id));
});

poRouter.post(
  '/from-recommendations',
  authorize(...can.createPO),
  validate({ body: z.object({ warehouseId: z.uuid(), productIds: z.array(z.uuid()).optional() }) }),
  async (req, res) => {
    const created = await createFromRecommendations({ ...req.body, userId: req.user!.id });
    res.status(201).json(created);
  },
);

poRouter.patch(
  '/:id',
  authorize(...can.createPO),
  validate({
    body: CreateBody.pick({ expectedDate: true, notes: true }).extend({ items: z.array(ItemSchema).min(1).optional() }),
  }),
  async (req, res) => {
    await updateDraft(req.params.id as string, req.body);
    res.json(await loadPo(req.params.id as string));
  },
);

const actions = {
  submit: 'SUBMITTED',
  approve: 'APPROVED',
  reject: 'DRAFT',
  receive: 'RECEIVED',
  cancel: 'CANCELLED',
} as const;

poRouter.post('/:id/:action', async (req, res) => {
  const action = req.params.action as keyof typeof actions;
  if (!(action in actions)) throw notFound('Action');
  await transition(req.params.id as string, actions[action], req.user!);
  res.json(await loadPo(req.params.id as string));
});

async function pdfFor(id: string) {
  const po = await loadPo(id);
  return {
    po,
    pdf: await renderPoPdf({
      ...po,
      items: po.items.map((i) => ({ ...i })),
    }),
  };
}

poRouter.get('/:id/pdf', async (req, res) => {
  const { po, pdf } = await pdfFor(req.params.id as string);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${po.poNumber}.pdf"`);
  res.send(pdf);
});

/** Emails the PO PDF to the supplier (logged to console in development). */
poRouter.post('/:id/email', authorize(...can.createPO), async (req, res) => {
  const { po, pdf } = await pdfFor(req.params.id as string);
  if (!po.supplier.email) throw badRequest('This supplier has no email address');
  if (!['SUBMITTED', 'APPROVED'].includes(po.status)) throw badRequest('Only submitted or approved orders can be sent');
  await sendMail({
    to: po.supplier.email,
    subject: `Purchase order ${po.poNumber} from StockSense`,
    text: `Dear ${po.supplier.contactName ?? po.supplier.name},\n\nPlease find attached purchase order ${po.poNumber} for delivery to ${po.warehouse.name}, ${po.warehouse.city}.\n\nRegards,\n${req.user!.name}`,
    attachments: [{ filename: `${po.poNumber}.pdf`, content: pdf }],
  });
  res.json({ sent: true, to: po.supplier.email });
});
