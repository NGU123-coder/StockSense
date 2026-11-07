import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { refreshTokens, users } from '../../db/schema';
import { authenticate, signAccessToken, type AuthUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { unauthorized } from '../../utils/httpError';

export const authRouter = Router();

const REFRESH_COOKIE = 'ss_refresh';
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

// Slow down password guessing: 20 login attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again in a few minutes' },
});

/**
 * Refresh tokens are random strings stored only as SHA-256 hashes, sent in an
 * httpOnly cookie (JavaScript can't read it, so XSS can't steal it), and rotated
 * on every use. The short-lived access token lives only in the frontend's memory.
 */
async function issueTokens(res: Response, user: AuthUser) {
  const refresh = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000);
  await db.insert(refreshTokens).values({ tokenHash: sha256(refresh), userId: user.id, expiresAt });
  res.cookie(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.COOKIE_SAMESITE === 'none',
    sameSite: env.COOKIE_SAMESITE,
    path: '/api/auth',
    expires: expiresAt,
  });
  return { accessToken: signAccessToken(user), user };
}

const toAuthUser = (u: typeof users.$inferSelect): AuthUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: z.object({ email: z.email().toLowerCase(), password: z.string().min(1) }) }),
  async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    const [user] = await db.select().from(users).where(eq(users.email, email));
    // Same error for unknown email and wrong password, so attackers can't discover accounts.
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw unauthorized('Incorrect email or password');
    }
    res.json(await issueTokens(res, toAuthUser(user)));
  },
);

authRouter.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!token) throw unauthorized('No session');

  const [row] = await db
    .select({ tokenId: refreshTokens.id, user: users })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(
      and(
        eq(refreshTokens.tokenHash, sha256(token)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ),
    );
  if (!row || !row.user.isActive) throw unauthorized('Session expired');

  // Rotation: the old refresh token can never be used again.
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.tokenId));
  res.json(await issueTokens(res, toAuthUser(row.user)));
});

authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (token) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, sha256(token)));
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).end();
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});
