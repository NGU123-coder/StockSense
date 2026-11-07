import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { Role } from '../db/schema';
import { forbidden, unauthorized } from '../utils/httpError';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email, role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AuthUser {
  const p = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  return { id: p.sub as string, name: p.name, email: p.email, role: p.role };
}

/** Requires a valid "Authorization: Bearer <token>" header. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  try {
    req.user = verifyAccessToken(header.slice(7));
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
  next();
};

/** Role-based access control: authorize('ADMIN', 'MANAGER'). */
export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

/** Who can do what, in one place. Mirrored in the frontend for showing/hiding buttons. */
export const can = {
  manageUsers: ['ADMIN'] as Role[],
  manageCatalog: ['ADMIN', 'MANAGER'] as Role[],
  moveStock: ['ADMIN', 'MANAGER'] as Role[],
  createPO: ['ADMIN', 'MANAGER', 'PURCHASER'] as Role[],
  approvePO: ['ADMIN', 'MANAGER'] as Role[],
  receivePO: ['ADMIN', 'MANAGER'] as Role[],
  runForecast: ['ADMIN', 'MANAGER'] as Role[],
  manageSuppliers: ['ADMIN', 'MANAGER', 'PURCHASER'] as Role[],
};
