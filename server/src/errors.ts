import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what = 'Não encontrado') => new HttpError(404, what);
export const forbidden = (what = 'Sem permissão') => new HttpError(403, what);
export const badRequest = (what: string) => new HttpError(400, what);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Dados inválidos', issues: err.issues });
  // Postgres invalid uuid syntax: treat as not found rather than a server error.
  if ((err as { code?: string }).code === '22P02') return res.status(404).json({ error: 'Não encontrado' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno' });
}
