import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { sql } from 'drizzle-orm';
import { env } from './config/env';
import { db } from './db/client';
import { getRedis } from './lib/redis';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { alertsRouter } from './modules/alerts/alerts.routes';
import { authRouter } from './modules/auth/auth.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { forecastRouter } from './modules/forecasts/forecast.routes';
import { productsRouter } from './modules/products/products.routes';
import { poRouter } from './modules/purchase-orders/po.routes';
import { stockRouter } from './modules/stock/stock.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
import { usersRouter } from './modules/users/users.routes';
import { warehousesRouter } from './modules/warehouses/warehouses.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // correct client IPs behind Render / nginx for rate limiting

  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_ORIGIN.split(','), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.get('/api/health', async (_req, res) => {
    let database = 'down';
    try {
      await db.execute(sql`select 1`);
      database = 'up';
    } catch {
      /* reported below */
    }
    const redis = getRedis().status === 'ready' ? 'up' : 'down';
    res.status(database === 'up' ? 200 : 503).json({ status: database === 'up' ? 'ok' : 'degraded', database, redis });
  });

  // General API rate limit (per IP). Login has its own stricter limiter.
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: env.NODE_ENV === 'test' ? 10_000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  const api = Router();
  api.use(apiLimiter);
  api.use('/auth', authRouter);

  // Everything below requires a signed-in user.
  api.use(authenticate);
  api.use('/dashboard', dashboardRouter);
  api.use('/products', productsRouter);
  api.use('/warehouses', warehousesRouter);
  api.use('/suppliers', suppliersRouter);
  api.use('/stock', stockRouter);
  api.use('/purchase-orders', poRouter);
  api.use('/forecasts', forecastRouter);
  api.use('/alerts', alertsRouter);
  api.use('/users', usersRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
