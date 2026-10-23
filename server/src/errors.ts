import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  /** `code` lets the app react to specific cases (e.g. 'email_unverified'). */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const notFound = (what = 'Não encontrado') => new HttpError(404, what);
export const forbidden = (what = 'Sem permissão') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  if (err instanceof ZodError) {
    // Our schemas carry Portuguese messages for what people type; anything else stays generic.
    const custom = err.issues.find((i) => i.code === 'custom' || (i.message && !/^(Invalid|Expected|Too|Unrecognized)/.test(i.message)));
    return res.status(400).json({ error: custom?.message ?? 'Dados inválidos', issues: err.issues });
  }
  if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Arquivo grande demais' });
  // Postgres invalid uuid syntax: treat as not found rather than a server error.
  if ((err as { code?: string }).code === '22P02') return res.status(404).json({ error: 'Não encontrado' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
}
