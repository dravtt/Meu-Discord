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

/** Per-user account state, cached: e-mail confirmed and whether the account is suspended. */
const state = new Map<string, { verified: boolean; banned: string | null }>();
export const markVerified = (userId: string) => { const s = state.get(userId); if (s) s.verified = true; };
/** Call after banning or unbanning so the change applies to the very next request. */
export const forgetAccountState = (userId: string) => state.delete(userId);

async function accountState(userId: string) {
  let s = state.get(userId);
  if (!s) {
    const row = await one<{ email_verified: boolean; banned_at: Date | null; banned_reason: string }>(
      'SELECT email_verified, banned_at, banned_reason FROM users WHERE id = $1', [userId]);
    s = { verified: !!row?.email_verified, banned: row?.banned_at ? row.banned_reason || '' : null };
    state.set(userId, s);
  }
  return s;
}

/** Suspended accounts cannot use anything. */
export async function bannedReason(userId: string) {
  return (await accountState(userId)).banned;
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
  accountState(userId).then((s) => {
    if (s.banned !== null) return next(new HttpError(403, `Esta conta foi suspensa${s.banned ? `: ${s.banned}` : '.'}`, 'banned'));
    if (!config.emailVerification || s.verified || UNVERIFIED_OK.test(req.originalUrl.split('?')[0])) return next();
    next(new HttpError(403, 'Confirme seu e-mail para continuar.', 'email_unverified'));
  }, next);
}

export const uid = (req: Request) => (req as AuthedRequest).userId;
