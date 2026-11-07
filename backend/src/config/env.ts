import 'dotenv/config';
import { z } from 'zod';

/** All configuration is validated at startup, so a missing variable fails fast and loudly. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(7),
  FORECAST_SERVICE_URL: z.string().default('http://localhost:8000'),
  INTERNAL_API_KEY: z.string().min(1),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('StockSense <alerts@stocksense.local>'),
  ALERT_EMAIL_TO: z.string().optional(),
  // Cross-site deployments (e.g. frontend on Vercel, API on Render) need SameSite=None + Secure.
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  ENABLE_JOBS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('✗ Invalid environment configuration:\n', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
