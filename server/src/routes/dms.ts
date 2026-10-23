import { Router } from 'express';
import { z } from 'zod';
import { one, query, transaction } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { getChannel } from '../permissions.js';
import { emitToUser } from '../realtime.js';
import { getPublicUser, serializeChannel } from '../serializers.js';
import { isBlockedBetween } from './relationships.js';

export const dmsRouter = Router();
dmsRouter.use(requireAuth);

const MAX_GROUP = 10;

export async function dmPayload(channelId: string) {
  const c = await getChannel(channelId);
  const recipients = await query('SELECT user_id FROM dm_recipients WHERE channel_id = $1', [channelId]);
  return { ...serializeChannel(c), recipients: await Promise.all(recipients.map((r) => getPublicUser(r.user_id))) };
}

async function notifyRecipients(channelId: string, event = 'dm:update') {
  const payload = await dmPayload(channelId);
  for (const r of payload.recipients) if (r) emitToUser(r.id, event, payload);
  return payload;
}

dmsRouter.get('/dms', async (req, res) => {
  const rows = await query(
    `SELECT c.id FROM channels c JOIN dm_recipients d ON d.channel_id = c.id
     WHERE d.user_id = $1 AND NOT d.closed ORDER BY coalesce(c.last_message_at, c.created_at) DESC`, [uid(req)]);
  res.json(await Promise.all(rows.map((r) => dmPayload(r.id))));
});

/** Opens (or reuses) a 1:1 DM, or creates a group DM when given several users. */
dmsRouter.post('/dms', async (req, res) => {
  const body = z.object({ userIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP - 1), name: z.string().max(100).optional() }).parse(req.body);
  const others = [...new Set(body.userIds)].filter((id) => id !== uid(req));
  if (others.length === 0) throw badRequest('Escolha pelo menos uma pessoa');
  for (const other of others) {
    if (!(await one('SELECT 1 FROM users WHERE id = $1', [other]))) throw notFound('Usuário não encontrado');
    if (await isBlockedBetween(uid(req), other)) throw forbidden('Não é possível conversar com este usuário');
  }

  if (others.length === 1) {
    const existing = await one(
      `SELECT c.id FROM channels c
       JOIN dm_recipients a ON a.channel_id = c.id AND a.user_id = $1
       JOIN dm_recipients b ON b.channel_id = c.id AND b.user_id = $2
       WHERE c.type = 'dm'`, [uid(req), others[0]]);
    if (existing) {
      await one('UPDATE dm_recipients SET closed = false WHERE channel_id = $1 AND user_id = $2', [existing.id, uid(req)]);
      return res.json(await dmPayload(existing.id));
    }
  } else {
    // Group DMs only with friends, as spam protection.
    const friends = await query("SELECT target_id FROM relationships WHERE user_id = $1 AND type = 'friend' AND target_id = ANY($2::uuid[])", [uid(req), others]);
    if (friends.length !== others.length) throw forbidden('Grupos só podem ser criados com amigos');
  }

  const channelId = await transaction(async (db) => {
    const type = others.length === 1 ? 'dm' : 'group_dm';
    const c = (await db.query('INSERT INTO channels (type, name, owner_id) VALUES ($1, $2, $3) RETURNING id', [type, body.name ?? '', type === 'group_dm' ? uid(req) : null])).rows[0];
    for (const userId of [uid(req), ...others]) await db.query('INSERT INTO dm_recipients (channel_id, user_id) VALUES ($1, $2)', [c.id, userId]);
    return c.id as string;
  });
  res.status(201).json(await notifyRecipients(channelId, 'dm:create'));
});

dmsRouter.patch('/dms/:channelId', async (req, res) => {
  const c = await getChannel(String(req.params.channelId));
  if (c.type !== 'group_dm' || !(await one('SELECT 1 FROM dm_recipients WHERE channel_id = $1 AND user_id = $2', [c.id, uid(req)]))) throw notFound();
  const { name } = z.object({ name: z.string().max(100) }).parse(req.body);
  await one('UPDATE channels SET name = $2 WHERE id = $1', [c.id, name]);
  res.json(await notifyRecipients(c.id));
});

dmsRouter.put('/dms/:channelId/recipients/:userId', async (req, res) => {
  const c = await getChannel(String(req.params.channelId));
  if (c.type !== 'group_dm' || !(await one('SELECT 1 FROM dm_recipients WHERE channel_id = $1 AND user_id = $2', [c.id, uid(req)]))) throw notFound();
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM dm_recipients WHERE channel_id = $1', [c.id]);
  if (count!.n >= MAX_GROUP) throw badRequest('O grupo está cheio');
  const target = String(req.params.userId);
  if (!(await one("SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 'friend'", [uid(req), target]))) throw forbidden('Só é possível adicionar amigos');
  await one('INSERT INTO dm_recipients (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c.id, target]);
  emitToUser(target, 'dm:create', await dmPayload(c.id));
  res.json(await notifyRecipients(c.id));
});

/** Closes a 1:1 DM for you: it leaves your list until someone sends a new message. */
dmsRouter.delete('/dms/:channelId', async (req, res) => {
  const c = await getChannel(String(req.params.channelId));
  if (c.type !== 'dm') throw badRequest('Para grupos, use sair do grupo');
  const row = await one('UPDATE dm_recipients SET closed = true WHERE channel_id = $1 AND user_id = $2 RETURNING 1', [c.id, uid(req)]);
  if (!row) throw notFound();
  emitToUser(uid(req), 'dm:delete', { id: c.id });
  res.status(204).end();
});

/** Leave a group DM (or remove someone, if you own it). 1:1 DMs are just closed client-side. */
dmsRouter.delete('/dms/:channelId/recipients/:userId', async (req, res) => {
  const c = await getChannel(String(req.params.channelId));
  const target = req.params.userId === '@me' ? uid(req) : String(req.params.userId);
  if (c.type !== 'group_dm') throw badRequest('Somente grupos');
  if (target !== uid(req) && c.owner_id !== uid(req)) throw forbidden();
  await one('DELETE FROM dm_recipients WHERE channel_id = $1 AND user_id = $2', [c.id, target]);
  emitToUser(target, 'dm:delete', { id: c.id });
  const remaining = await query('SELECT user_id FROM dm_recipients WHERE channel_id = $1', [c.id]);
  if (remaining.length === 0) await one('DELETE FROM channels WHERE id = $1', [c.id]);
  else {
    if (c.owner_id === target) await one('UPDATE channels SET owner_id = $2 WHERE id = $1', [c.id, remaining[0].user_id]);
    await notifyRecipients(c.id);
  }
  res.status(204).end();
});
