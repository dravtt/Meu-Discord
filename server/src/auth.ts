import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { HttpError } from './errors.js';

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

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    (req as AuthedRequest).userId = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, 'Não autenticado'));
  }
}

export const uid = (req: Request) => (req as AuthedRequest).userId;
