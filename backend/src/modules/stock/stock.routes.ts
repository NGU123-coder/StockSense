import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { movementTypeEnum, products, stockMovements, users, warehouses } from '../../db/schema';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { recordMovement, transferStock } from './stock.service';

export const stockRouter = Router();

const MovementBody = z
  .object({
    productId: z.uuid(),
    warehouseId: z.uuid(),
    type: z.enum(['RECEIPT', 'SALE', 'ADJUSTMENT']),
    quantity: z.coerce
      .number()
      .int()
      .refine((n) => n !== 0, 'Quantity cannot be zero'),
    note: z.string().trim().max(300).optional(),
    reference: z.string().trim().max(60).optional(),
  })
  .refine((b) => b.type === 'ADJUSTMENT' || b.quantity > 0, {
    message: 'Quantity must be positive for receipts and sales',
    path: ['quantity'],
  });

stockRouter.post('/movements', authorize(...can.moveStock), validate({ body: MovementBody }), async (req, res) => {
  const result = await recordMovement({ ...req.body, userId: req.user!.id });
  res.status(201).json(result);
});

const TransferBody = z.object({
  productId: z.uuid(),
  fromWarehouseId: z.uuid(),
  toWarehouseId: z.uuid(),
  quantity: z.coerce.number().int().positive(),
  note: z.string().trim().max(300).optional(),
});

stockRouter.post('/transfers', authorize(...can.moveStock), validate({ body: TransferBody }), async (req, res) => {
  const result = await transferStock({ ...req.body, userId: req.user!.id });
  res.status(201).json(result);
});

const MovementsQuery = z.object({
  warehouseId: z.uuid().optional(),
  type: z.enum(movementTypeEnum.enumValues).optional(),
  manualOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Recent stock activity. By default hides automated daily POS sales imports. */
stockRouter.get('/movements', validate({ query: MovementsQuery }), async (_req, res) => {
  const q = res.locals.query as z.infer<typeof MovementsQuery>;
  const filters: (SQL | undefined)[] = [
    q.warehouseId ? eq(stockMovements.warehouseId, q.warehouseId) : undefined,
    q.type ? eq(stockMovements.type, q.type) : undefined,
    q.manualOnly ? sql`${stockMovements.userId} is not null` : undefined,
  ];
  const rows = await db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      reference: stockMovements.reference,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      warehouseName: warehouses.name,
      userName: users.name,
    })
    .from(stockMovements)
    .innerJoin(products, eq(products.id, stockMovements.productId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .leftJoin(users, eq(users.id, stockMovements.userId))
    .where(and(...filters))
    .orderBy(desc(stockMovements.createdAt))
    .limit(q.limit);
  res.json(rows);
});
