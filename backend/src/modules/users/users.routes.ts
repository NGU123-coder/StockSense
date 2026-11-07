import bcrypt from 'bcryptjs';
import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/client';
import { roleEnum, users } from '../../db/schema';
import { authorize, can } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { badRequest, notFound } from '../../utils/httpError';

export const usersRouter = Router();
usersRouter.use(authorize(...can.manageUsers));

const publicCols = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

usersRouter.get('/', async (_req, res) => {
  res.json(await db.select(publicCols).from(users).orderBy(asc(users.name)));
});

usersRouter.post(
  '/',
  validate({
    body: z.object({
      name: z.string().trim().min(2),
      email: z.email().toLowerCase(),
      password: z.string().min(8, 'Use at least 8 characters'),
      role: z.enum(roleEnum.enumValues),
    }),
  }),
  async (req, res) => {
    const { password, ...rest } = req.body;
    const [user] = await db
      .insert(users)
      .values({ ...rest, passwordHash: await bcrypt.hash(password, 10) })
      .returning(publicCols);
    res.status(201).json(user);
  },
);

usersRouter.patch(
  '/:id',
  validate({
    body: z.object({
      name: z.string().trim().min(2).optional(),
      role: z.enum(roleEnum.enumValues).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  async (req, res) => {
    const id = req.params.id as string;
    if (id === req.user!.id && (req.body.role || req.body.isActive === false)) {
      throw badRequest('You cannot change your own role or deactivate yourself');
    }
    const [user] = await db.update(users).set(req.body).where(eq(users.id, id)).returning(publicCols);
    if (!user) throw notFound('User');
    res.json(user);
  },
);
