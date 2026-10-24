import { promises as dns } from 'node:dns';
import { config } from './config.js';
import { HttpError } from './errors.js';
import { one, query } from './db.js';
import { emitToUser } from './realtime.js';

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

/* ---------- punishments ---------- */

/** Each mute lasts longer than the last one in the same day: 10 min, 1 h, 6 h, 24 h. */
const MUTE_STEPS_MS = [10 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];
/** Strikes in an hour that earn a mute. */
export const STRIKES_TO_MUTE = 3;
const lastStrike = new Map<string, number>();

export const minutesLeft = (until: Date) => Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
const humanWait = (until: Date) => { const m = minutesLeft(until); return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`; };

/** Muted people cannot send messages, friend requests, new DMs or invites. */
export async function assertNotMuted(userId: string) {
  const u = await one<{ muted_until: Date | null }>('SELECT muted_until FROM users WHERE id = $1', [userId]);
  if (u?.muted_until && u.muted_until > new Date()) {
    throw new HttpError(403, `Você foi silenciado por spam. Espere mais ${humanWait(u.muted_until)}.`, 'muted');
  }
}

/**
 * Runs the spam checks in `fn`. When one of them stops the user, that counts as a strike and goes to
 * the spam log; three strikes in an hour mute them.
 */
export async function spamGuard(userId: string, kind: string, where: { serverId?: string | null; channelId?: string | null }, fn: () => void) {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) await strike(userId, kind, where).catch((e) => console.error('strike failed', e));
    throw err;
  }
}

async function strike(userId: string, kind: string, where: { serverId?: string | null; channelId?: string | null }) {
  // A burst of blocked requests is one strike, not dozens.
  const key = `${userId}:${kind}`;
  if (Date.now() - (lastStrike.get(key) ?? 0) < 15_000) return;
  lastStrike.set(key, Date.now());
  await query('INSERT INTO spam_log (user_id, kind, server_id, channel_id) VALUES ($1, $2, $3, $4)', [userId, kind, where.serverId ?? null, where.channelId ?? null]);
  const r = await one<{ strikes: number; mutes: number }>(
    `SELECT count(*) FILTER (WHERE kind <> 'mute' AND created_at > now() - interval '1 hour'
                             AND created_at > coalesce((SELECT max(created_at) FROM spam_log WHERE user_id = $1 AND kind = 'mute'), '-infinity'))::int AS strikes,
            count(*) FILTER (WHERE kind = 'mute' AND created_at > now() - interval '24 hours')::int AS mutes
     FROM spam_log WHERE user_id = $1`, [userId]);
  if (!r || r.strikes < STRIKES_TO_MUTE) return;
  const until = new Date(Date.now() + MUTE_STEPS_MS[Math.min(r.mutes, MUTE_STEPS_MS.length - 1)]);
  await query('UPDATE users SET muted_until = $2 WHERE id = $1', [userId, until]);
  await query("INSERT INTO spam_log (user_id, kind, server_id, channel_id, muted_until) VALUES ($1, 'mute', $2, $3, $4)", [userId, where.serverId ?? null, where.channelId ?? null, until]);
  emitToUser(userId, 'account:muted', { mutedUntil: until });
}

/** Lets tests start each case with a clean slate. */
export const resetStrikes = () => lastStrike.clear();

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
