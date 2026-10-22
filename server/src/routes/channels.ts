import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, notFound } from '../errors.js';
import { getChannel, P, requireChannel, requireServer } from '../permissions.js';
import { emitToChannel, emitToServer } from '../realtime.js';
import { loadMessages, serializeChannel } from '../serializers.js';

export const channelsRouter = Router();
channelsRouter.use(requireAuth);

const SERVER_TYPES = ['text', 'voice', 'category'] as const;

channelsRouter.post('/servers/:serverId/channels', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.MANAGE_CHANNELS);
  const body = z.object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(SERVER_TYPES).default('text'),
    parentId: z.string().uuid().nullable().optional(),
    topic: z.string().max(1024).optional(),
    private: z.boolean().optional(),
  }).parse(req.body);
  const name = body.type === 'text' ? body.name.toLowerCase().replace(/\s+/g, '-') : body.name;
  if (body.parentId && !(await one("SELECT 1 FROM channels WHERE id = $1 AND server_id = $2 AND type = 'category'", [body.parentId, serverId]))) {
    throw badRequest('Categoria inválida');
  }
  const pos = await one<{ next: number }>('SELECT coalesce(max(position) + 1, 0) AS next FROM channels WHERE server_id = $1 AND parent_id IS NOT DISTINCT FROM $2', [serverId, body.type === 'category' ? null : body.parentId ?? null]);
  const channel = await one(
    'INSERT INTO channels (server_id, parent_id, type, name, topic, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [serverId, body.type === 'category' ? null : body.parentId ?? null, body.type, name, body.topic ?? '', pos!.next]);
  if (body.private) {
    // Private channel: hide from @everyone, keep visible to the creator.
    const everyone = await one('SELECT id FROM roles WHERE server_id = $1 AND is_default', [serverId]);
    await one("INSERT INTO overwrites (channel_id, target_id, target_type, deny) VALUES ($1, $2, 'role', $3)", [channel.id, everyone.id, P.VIEW_CHANNEL]);
    await one("INSERT INTO overwrites (channel_id, target_id, target_type, allow) VALUES ($1, $2, 'member', $3)", [channel.id, uid(req), P.VIEW_CHANNEL]);
  }
  // Clients refetch the snapshot so each one gets only what it may see.
  emitToServer(serverId, 'server:refresh', { serverId });
  res.status(201).json(serializeChannel(channel));
});

channelsRouter.get('/channels/:channelId', async (req, res) => {
  const { channel, perms } = await requireChannel(String(req.params.channelId), uid(req));
  res.json({ ...serializeChannel(channel), permissions: perms });
});

channelsRouter.patch('/channels/:channelId', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.MANAGE_CHANNELS);
  const body = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    topic: z.string().max(1024).optional(),
    parentId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).optional(),
  }).parse(req.body);
  const updated = await one(
    `UPDATE channels SET name = COALESCE($2, name), topic = COALESCE($3, topic),
       parent_id = CASE WHEN $4::boolean THEN $5::uuid ELSE parent_id END, position = COALESCE($6, position)
     WHERE id = $1 RETURNING *`,
    [channel.id, body.name ?? null, body.topic ?? null, body.parentId !== undefined, body.parentId ?? null, body.position ?? null]);
  if (channel.server_id) emitToServer(channel.server_id, 'server:refresh', { serverId: channel.server_id });
  else await emitToChannel(updated, 'channel:update', serializeChannel(updated));
  res.json(serializeChannel(updated));
});

channelsRouter.delete('/channels/:channelId', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.MANAGE_CHANNELS);
  if (!channel.server_id) throw badRequest('Use a rota de DMs para sair de uma conversa');
  await one('DELETE FROM channels WHERE id = $1', [channel.id]);
  emitToServer(channel.server_id, 'channel:delete', { id: channel.id, serverId: channel.server_id });
  emitToServer(channel.server_id, 'server:refresh', { serverId: channel.server_id });
  res.status(204).end();
});

channelsRouter.put('/channels/:channelId/overwrites/:targetId', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.MANAGE_ROLES);
  if (!channel.server_id) throw badRequest('Somente canais de servidor');
  const body = z.object({ type: z.enum(['role', 'member']), allow: z.number().int().nonnegative(), deny: z.number().int().nonnegative() }).parse(req.body);
  await one(
    `INSERT INTO overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = $4, deny = $5, target_type = $3`,
    [channel.id, req.params.targetId, body.type, body.allow, body.deny]);
  emitToServer(channel.server_id, 'server:refresh', { serverId: channel.server_id });
  res.status(204).end();
});

channelsRouter.delete('/channels/:channelId/overwrites/:targetId', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.MANAGE_ROLES);
  await one('DELETE FROM overwrites WHERE channel_id = $1 AND target_id = $2', [channel.id, req.params.targetId]);
  if (channel.server_id) emitToServer(channel.server_id, 'server:refresh', { serverId: channel.server_id });
  res.status(204).end();
});

/* ---------- threads ---------- */

channelsRouter.post('/channels/:channelId/messages/:messageId/threads', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.CREATE_THREADS);
  if (channel.type !== 'text') throw badRequest('Tópicos só podem ser criados em canais de texto');
  const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
  const message = await one('SELECT * FROM messages WHERE id = $1 AND channel_id = $2', [req.params.messageId, channel.id]);
  if (!message) throw notFound('Mensagem não encontrada');
  if (message.thread_id) throw badRequest('Esta mensagem já tem um tópico');
  const thread = await one(
    "INSERT INTO channels (server_id, parent_id, type, name, owner_id) VALUES ($1, $2, 'thread', $3, $4) RETURNING *",
    [channel.server_id, channel.id, name, uid(req)]);
  await one('UPDATE messages SET thread_id = $2 WHERE id = $1', [message.id, thread.id]);
  await emitToChannel(channel, 'thread:create', serializeChannel(thread));
  const [updated] = await loadMessages([message.id], uid(req));
  await emitToChannel(channel, 'message:update', updated);
  res.status(201).json(serializeChannel(thread));
});

channelsRouter.get('/channels/:channelId/threads', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req));
  const threads = await query("SELECT * FROM channels WHERE parent_id = $1 AND type = 'thread' ORDER BY coalesce(last_message_at, created_at) DESC", [channel.id]);
  res.json(threads.map(serializeChannel));
});

/* ---------- read state, pins ---------- */

channelsRouter.post('/channels/:channelId/ack', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req));
  await one(
    `INSERT INTO read_states (user_id, channel_id, last_read_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = now()`, [uid(req), channel.id]);
  res.status(204).end();
});

/** Unread flag and mention count for every channel the user belongs to (servers and DMs). */
channelsRouter.get('/read-states', async (req, res) => {
  const rows = await query(
    `WITH mine AS (
       SELECT c.id, c.last_message_at FROM channels c JOIN members m ON m.server_id = c.server_id WHERE m.user_id = $1 AND c.type IN ('text', 'thread')
       UNION
       SELECT c.id, c.last_message_at FROM channels c JOIN dm_recipients d ON d.channel_id = c.id WHERE d.user_id = $1
     )
     SELECT mine.id AS channel_id, mine.last_message_at, rs.last_read_at,
       (SELECT count(*)::int FROM messages msg
        WHERE msg.channel_id = mine.id AND msg.author_id <> $1 AND msg.created_at > coalesce(rs.last_read_at, 'epoch')
          AND (msg.mention_everyone OR EXISTS (SELECT 1 FROM message_mentions mm WHERE mm.message_id = msg.id AND mm.user_id = $1))) AS mentions
     FROM mine LEFT JOIN read_states rs ON rs.channel_id = mine.id AND rs.user_id = $1`, [uid(req)]);
  res.json(rows.map((r) => ({
    channelId: r.channel_id,
    unread: !!r.last_message_at && (!r.last_read_at || r.last_message_at > r.last_read_at),
    mentions: r.mentions,
  })));
});

channelsRouter.get('/channels/:channelId/pins', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.READ_HISTORY);
  const ids = await query('SELECT id FROM messages WHERE channel_id = $1 AND pinned ORDER BY created_at DESC', [channel.id]);
  res.json(await loadMessages(ids.map((r) => r.id), uid(req)));
});

export { getChannel };
