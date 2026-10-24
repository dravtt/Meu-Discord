import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { forgetAccountState, requireAuth, uid } from '../auth.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { config } from '../config.js';
import { P, requireServer } from '../permissions.js';
import { emitToUser, kickUser } from '../realtime.js';
import { getPublicUser } from '../serializers.js';
import { rateLimit } from '../guard.js';

export const moderationRouter = Router();
moderationRouter.use(requireAuth);

export const REPORT_REASONS = ['spam', 'harassment', 'adult', 'scam', 'other'] as const;

/**
 * Voka admins: accounts whose verified e-mail is in NEXO_ADMIN_EMAILS or whose username is in NEXO_ADMINS.
 * With neither set, whoever created the first account (only outside production, see config.firstUserAdmin).
 */
export async function isAdmin(userId: string) {
  const u = await one<{ username: string; email: string | null; email_verified: boolean; first: boolean }>(
    'SELECT username, email, email_verified, id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1) AS first FROM users WHERE id = $1', [userId]);
  if (!u) return false;
  if (config.adminEmails.length || config.admins.length) {
    return (!!u.email && u.email_verified && config.adminEmails.includes(u.email.toLowerCase())) || config.admins.includes(u.username);
  }
  return config.firstUserAdmin && u.first;
}

async function requireAdmin(userId: string) {
  if (!(await isAdmin(userId))) throw forbidden('Só a administração do Voka pode ver isso');
}

/* ---------- reports ---------- */

moderationRouter.post('/reports', async (req, res) => {
  const body = z.object({
    targetId: z.string().uuid(),
    messageId: z.string().uuid().optional(),
    reason: z.enum(REPORT_REASONS),
    details: z.string().trim().max(500).default(''),
  }).parse(req.body);
  if (body.targetId === uid(req)) throw badRequest('Você não pode denunciar a si mesmo');
  rateLimit(`report:${uid(req)}`, 10, 60 * 60_000, 'Você mandou denúncias demais. Tente de novo mais tarde.');
  if (!(await one('SELECT 1 FROM users WHERE id = $1', [body.targetId]))) throw notFound('Usuário não encontrado');
  const msg = body.messageId
    ? await one<{ content: string; channel_id: string }>('SELECT content, channel_id FROM messages WHERE id = $1 AND author_id = $2', [body.messageId, body.targetId])
    : null;
  if (body.messageId && !msg) throw notFound('Mensagem não encontrada');
  // Repeated reports of the same thing by the same person only count once.
  const dup = await one(`SELECT 1 FROM reports WHERE reporter_id = $1 AND target_id = $2 AND status = 'open'
                         AND message_id IS NOT DISTINCT FROM $3`, [uid(req), body.targetId, body.messageId ?? null]);
  if (!dup) {
    await query(`INSERT INTO reports (reporter_id, target_id, message_id, message_content, channel_id, reason, details)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uid(req), body.targetId, body.messageId ?? null, msg?.content ?? '', msg?.channel_id ?? null, body.reason, body.details]);
  }
  res.status(201).json({ ok: true });
});

/* ---------- spam log ---------- */

async function serializeLog(rows: any[]) {
  return Promise.all(rows.map(async (r) => ({
    id: r.id, kind: r.kind, createdAt: r.created_at, mutedUntil: r.muted_until,
    serverId: r.server_id, serverName: r.server_name ?? null, channelName: r.channel_name ?? null,
    user: await getPublicUser(r.user_id),
  })));
}

const LOG_SELECT = `SELECT l.*, s.name AS server_name, c.name AS channel_name FROM spam_log l
  LEFT JOIN servers s ON s.id = l.server_id LEFT JOIN channels c ON c.id = l.channel_id`;

/** Who was stopped by the spam limits in this server; for people who can manage it. */
moderationRouter.get('/servers/:serverId/spam-log', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.MANAGE_SERVER);
  res.json(await serializeLog(await query(`${LOG_SELECT} WHERE l.server_id = $1 ORDER BY l.created_at DESC LIMIT 100`, [serverId])));
});

/* ---------- admin ---------- */

moderationRouter.get('/admin/spam-log', async (req, res) => {
  await requireAdmin(uid(req));
  res.json(await serializeLog(await query(`${LOG_SELECT} ORDER BY l.created_at DESC LIMIT 200`)));
});

async function accountInfo(userId: string) {
  const u = await one<{ banned_at: Date | null; banned_reason: string; muted_until: Date | null; email: string | null }>(
    'SELECT banned_at, banned_reason, muted_until, email FROM users WHERE id = $1', [userId]);
  return {
    ...(await getPublicUser(userId)),
    bannedAt: u?.banned_at ?? null, bannedReason: u?.banned_reason ?? '',
    mutedUntil: u?.muted_until && u.muted_until > new Date() ? u.muted_until : null,
  };
}

moderationRouter.get('/admin/reports', async (req, res) => {
  await requireAdmin(uid(req));
  const all = req.query.status === 'all';
  const rows = await query(`SELECT * FROM reports ${all ? '' : "WHERE status = 'open'"} ORDER BY created_at DESC LIMIT 200`);
  res.json(await Promise.all(rows.map(async (r) => ({
    id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at,
    messageId: r.message_id, messageContent: r.message_content,
    reporter: await getPublicUser(r.reporter_id), target: await accountInfo(r.target_id),
  }))));
});

moderationRouter.post('/admin/reports/:id', async (req, res) => {
  await requireAdmin(uid(req));
  const { status } = z.object({ status: z.enum(['dismissed', 'actioned', 'open']) }).parse(req.body);
  const r = await one('UPDATE reports SET status = $2, handled_by = $3, handled_at = now() WHERE id = $1 RETURNING id', [req.params.id, status, uid(req)]);
  if (!r) throw notFound('Denúncia não encontrada');
  res.json({ ok: true });
});

moderationRouter.get('/admin/users/banned', async (req, res) => {
  await requireAdmin(uid(req));
  const rows = await query('SELECT id FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC');
  res.json(await Promise.all(rows.map((r) => accountInfo(r.id))));
});

async function targetFor(req: { params: Record<string, unknown> }, me: string) {
  const id = String(req.params.id);
  if (id === me) throw badRequest('Você não pode fazer isso com a sua própria conta');
  if (!(await one('SELECT 1 FROM users WHERE id = $1', [id]))) throw notFound('Usuário não encontrado');
  if (await isAdmin(id)) throw forbidden('Não dá para punir a administração');
  return id;
}

moderationRouter.post('/admin/users/:id/ban', async (req, res) => {
  await requireAdmin(uid(req));
  const id = await targetFor(req, uid(req));
  const { reason } = z.object({ reason: z.string().trim().max(200).default('') }).parse(req.body ?? {});
  await query('UPDATE users SET banned_at = now(), banned_reason = $2, activity = NULL WHERE id = $1', [id, reason]);
  forgetAccountState(id);
  kickUser(id, reason);
  res.json(await accountInfo(id));
});

moderationRouter.delete('/admin/users/:id/ban', async (req, res) => {
  await requireAdmin(uid(req));
  const id = await targetFor(req, uid(req));
  await query("UPDATE users SET banned_at = NULL, banned_reason = '' WHERE id = $1", [id]);
  forgetAccountState(id);
  res.json(await accountInfo(id));
});

/** Mutes for some minutes (0 lifts the mute). */
moderationRouter.post('/admin/users/:id/mute', async (req, res) => {
  await requireAdmin(uid(req));
  const id = await targetFor(req, uid(req));
  const { minutes } = z.object({ minutes: z.number().int().min(0).max(60 * 24 * 30) }).parse(req.body);
  const until = minutes ? new Date(Date.now() + minutes * 60_000) : null;
  await query('UPDATE users SET muted_until = $2 WHERE id = $1', [id, until]);
  if (until) await query("INSERT INTO spam_log (user_id, kind, muted_until) VALUES ($1, 'mute', $2)", [id, until]);
  emitToUser(id, 'account:muted', { mutedUntil: until });
  res.json(await accountInfo(id));
});
