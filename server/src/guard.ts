import { promises as dns } from 'node:dns';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { one } from './db.js';

/* ---------- rate limits (in memory; enough for one server process) ---------- */

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

/** Allows `max` actions per `windowMs` for `key`; past that, answers 429 with a friendly message. */
export function rateLimit(key: string, max: number, windowMs: number, message = 'Calma aí! Você está fazendo isso rápido demais.') {
  if (!config.rateLimits) return;
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 3_600_000) hits.delete(k);
    lastSweep = now;
  }
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    throw new HttpError(429, message);
  }
  list.push(now);
  hits.set(key, list);
}

/** Forget a key (e.g. after a successful login). */
export const clearLimit = (key: string) => hits.delete(key);

/** Recent message contents per user, to stop the same text being flooded. */
const recent = new Map<string, { text: string; at: number }[]>();
export function assertNotRepeating(userId: string, text: string) {
  if (!config.rateLimits || !text.trim()) return;
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((m) => now - m.at < 30_000);
  if (list.filter((m) => m.text === text).length >= 3) throw new HttpError(429, 'Você mandou a mesma mensagem várias vezes seguidas. Espere um pouco.');
  list.push({ text, at: now });
  recent.set(userId, list.slice(-10));
}

/* ---------- servers ---------- */

export async function assertServerSlot(userId: string) {
  const row = await one<{ n: number }>('SELECT count(*)::int AS n FROM members WHERE user_id = $1', [userId]);
  if ((row?.n ?? 0) >= config.maxServersPerUser) throw new HttpError(403, `Você já está em ${config.maxServersPerUser} servidores, o máximo permitido. Saia de algum para entrar em outro.`);
}

/* ---------- age ---------- */

export function ageOn(birthdate: string | Date, today = new Date()) {
  const b = new Date(birthdate);
  let age = today.getUTCFullYear() - b.getUTCFullYear();
  const m = today.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** +18 servers: only adults may join or see them. */
export async function assertAdult(userId: string) {
  const u = await one<{ birthdate: Date | null }>('SELECT birthdate FROM users WHERE id = $1', [userId]);
  if (!u?.birthdate) throw new HttpError(403, 'Este servidor é +18. Informe sua data de nascimento em Configurações > Minha conta para entrar.');
  if (ageOn(u.birthdate) < 18) throw new HttpError(403, 'Este servidor é só para maiores de 18 anos.');
}

/* ---------- e-mail ---------- */

/** Throwaway inbox providers commonly used by spam accounts. */
const DISPOSABLE = new Set([
  'mailinator.com', '10minutemail.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', 'yopmail.com', 'temp-mail.org',
  'tempmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
  'emailondeck.com', 'mohmal.com', 'tempmailo.com', 'tempail.com', 'burnermail.io', 'moakt.com', 'mail.tm', 'spamgourmet.com', 'grr.la',
]);

/** Rejects addresses whose domain is disposable or cannot receive mail. */
export async function assertDeliverableEmail(email: string) {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (DISPOSABLE.has(domain)) throw new HttpError(400, 'Use um e-mail de verdade (e-mails temporários não são aceitos).');
  if (!config.checkMx) return;
  try {
    const mx = await Promise.race([dns.resolveMx(domain), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (!mx.length) throw new Error('no mx');
  } catch (e) {
    const code = (e as { code?: string }).code;
    // Only a definite "this domain does not exist / has no mail" is an error; a DNS hiccup is not the user's fault.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || (e as Error).message === 'no mx') throw new HttpError(400, 'Esse e-mail não existe. Confira se digitou certo.');
  }
}
