import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { one } from './db.js';

export interface AuthedRequest extends Request {
  userId: string;
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): string {
  const payload = jwt.verify(token, config.jwtSecret);
  if (typeof payload === 'string' || !payload.sub) throw new Error('invalid token');
  return payload.sub;
}

/** Whether each user confirmed their e-mail; once true it stays true, so it is cached. */
const verified = new Map<string, boolean>();
export const markVerified = (userId: string) => verified.set(userId, true);

async function isVerified(userId: string) {
  if (!config.emailVerification) return true;
  const cached = verified.get(userId);
  if (cached) return true;
  const row = await one<{ email_verified: boolean }>('SELECT email_verified FROM users WHERE id = $1', [userId]);
  if (row?.email_verified) verified.set(userId, true);
  return !!row?.email_verified;
}

/** What someone who has not confirmed their e-mail yet may still do. */
const UNVERIFIED_OK = /^\/api\/(auth\/|users\/@me(\/email(\/(verify|resend))?)?$|uploads\/image$)/;

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let userId: string;
  try {
    userId = verifyToken(token);
  } catch {
    return next(new HttpError(401, 'Não autenticado'));
  }
  (req as AuthedRequest).userId = userId;
  if (UNVERIFIED_OK.test(req.originalUrl.split('?')[0])) return next();
  isVerified(userId).then((ok) => next(ok ? undefined : new HttpError(403, 'Confirme seu e-mail para continuar.', 'email_unverified')), next);
}

export const uid = (req: Request) => (req as AuthedRequest).userId;
