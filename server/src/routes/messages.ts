import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { one, query, transaction } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { has, P, requireChannel, type ChannelRow } from '../permissions.js';
import { emitToChannel, emitToUser } from '../realtime.js';
import { dmPayload } from './dms.js';
import { loadMessage, loadMessages, reactionSummary } from '../serializers.js';
import { config } from '../config.js';
import { isBlockedBetween } from './relationships.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 16)}`),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 10 },
});

messagesRouter.get('/channels/:channelId/messages', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.READ_HISTORY);
  const q = z.object({
    before: z.string().uuid().optional(),
    around: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }).parse(req.query);
  let ids: { id: string }[];
  if (q.around) {
    const half = Math.floor(q.limit / 2);
    ids = await query(
      `(SELECT id, created_at FROM messages WHERE channel_id = $1 AND created_at <= (SELECT created_at FROM messages WHERE id = $2) ORDER BY created_at DESC LIMIT $3)
       UNION ALL
       (SELECT id, created_at FROM messages WHERE channel_id = $1 AND created_at > (SELECT created_at FROM messages WHERE id = $2) ORDER BY created_at LIMIT $4)
       ORDER BY created_at DESC`, [channel.id, q.around, half + 1, half]);
  } else {
    ids = await query(
      `SELECT id FROM messages WHERE channel_id = $1
       AND ($2::uuid IS NULL OR created_at < (SELECT created_at FROM messages WHERE id = $2))
       ORDER BY created_at DESC LIMIT $3`, [channel.id, q.before ?? null, q.limit]);
  }
  // Oldest first, as the client renders them.
  res.json((await loadMessages(ids.map((r) => r.id), uid(req))).reverse());
});

const MENTION_RE = /<@([0-9a-f-]{36})>/g;

/** For DMs, refuses to deliver when either side blocked the other. */
async function assertDmAllowed(channel: ChannelRow, userId: string) {
  if (channel.type !== 'dm') return;
  const other = await one('SELECT user_id FROM dm_recipients WHERE channel_id = $1 AND user_id <> $2', [channel.id, userId]);
  if (other && (await isBlockedBetween(userId, other.user_id))) throw forbidden('Não é possível enviar mensagens para este usuário');
}

messagesRouter.post('/channels/:channelId/messages', upload.array('files', 10), async (req, res) => {
  const { channel, perms } = await requireChannel(String(req.params.channelId), uid(req), P.SEND_MESSAGES);
  if (channel.type === 'voice' || channel.type === 'category') throw badRequest('Este canal não aceita mensagens');
  await assertDmAllowed(channel, uid(req));
  const body = z.object({
    content: z.string().max(4000).default(''),
    replyToId: z.string().uuid().optional(),
  }).parse(req.body);
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length && !has(perms, P.ATTACH_FILES)) throw forbidden('Sem permissão para enviar arquivos');
  const content = body.content.trim();
  if (!content && files.length === 0) throw badRequest('Mensagem vazia');
  if (body.replyToId && !(await one('SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2', [body.replyToId, channel.id]))) {
    throw badRequest('Mensagem respondida não encontrada');
  }

  const mentionEveryone = /@(everyone|here)\b/.test(content) && has(perms, P.MENTION_EVERYONE);
  const mentioned = [...new Set([...content.matchAll(MENTION_RE)].map((m) => m[1]))];
  // Replying pings the original author, like a mention.
  if (body.replyToId) {
    const parent = await one('SELECT author_id FROM messages WHERE id = $1', [body.replyToId]);
    if (parent && parent.author_id !== uid(req)) mentioned.push(parent.author_id);
  }

  const id = await transaction(async (db) => {
    const m = (await db.query(
      'INSERT INTO messages (channel_id, author_id, content, reply_to_id, mention_everyone) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
      [channel.id, uid(req), content, body.replyToId ?? null, mentionEveryone])).rows[0];
    if (mentioned.length) {
      await db.query(
        'INSERT INTO message_mentions (message_id, user_id) SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[]) ON CONFLICT DO NOTHING',
        [m.id, [...new Set(mentioned)]]);
    }
    for (const f of files) {
      await db.query('INSERT INTO attachments (message_id, url, filename, size, content_type) VALUES ($1, $2, $3, $4, $5)',
        [m.id, `/uploads/${f.filename}`, f.originalname, f.size, f.mimetype]);
    }
    await db.query('UPDATE channels SET last_message_at = $2 WHERE id = $1', [channel.id, m.created_at]);
    // Sending marks the channel read for the author.
    await db.query(`INSERT INTO read_states (user_id, channel_id, last_read_at) VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_at = $3`, [uid(req), channel.id, m.created_at]);
    return m.id as string;
  });

  const message = await loadMessage(id, uid(req));
  if (channel.type === 'dm') {
    // A new message reopens the conversation for anyone who had closed it.
    const reopened = await query('UPDATE dm_recipients SET closed = false WHERE channel_id = $1 AND closed RETURNING user_id', [channel.id]);
    if (reopened.length) {
      const payload = await dmPayload(channel.id);
      for (const r of reopened) emitToUser(r.user_id, 'dm:create', payload);
    }
  }
  await emitToChannel(channel, 'message:create', message);
  res.status(201).json(message);
});

async function loadOwnedOrModerated(req: any, needManage: boolean) {
  const { channel, perms } = await requireChannel(String(req.params.channelId), uid(req));
  const message = await one('SELECT * FROM messages WHERE id = $1 AND channel_id = $2', [req.params.messageId, channel.id]);
  if (!message) throw notFound('Mensagem não encontrada');
  const isAuthor = message.author_id === uid(req);
  if (!isAuthor && !(needManage && has(perms, P.MANAGE_MESSAGES))) throw forbidden();
  return { channel, message, perms };
}

messagesRouter.patch('/channels/:channelId/messages/:messageId', async (req, res) => {
  const { channel, message } = await loadOwnedOrModerated(req, false);
  const { content } = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);
  await transaction(async (db) => {
    await db.query('UPDATE messages SET content = $2, edited_at = now() WHERE id = $1', [message.id, content]);
    await db.query('DELETE FROM message_mentions WHERE message_id = $1', [message.id]);
    const ids = [...new Set([...content.matchAll(MENTION_RE)].map((m) => m[1]))];
    if (ids.length) {
      await db.query('INSERT INTO message_mentions (message_id, user_id) SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[]) ON CONFLICT DO NOTHING', [message.id, ids]);
    }
  });
  const updated = await loadMessage(message.id, uid(req));
  await emitToChannel(channel, 'message:update', updated);
  res.json(updated);
});

messagesRouter.delete('/channels/:channelId/messages/:messageId', async (req, res) => {
  const { channel, message } = await loadOwnedOrModerated(req, true);
  await one('DELETE FROM messages WHERE id = $1', [message.id]);
  await emitToChannel(channel, 'message:delete', { id: message.id, channelId: channel.id });
  res.status(204).end();
});

/* ---------- reactions ---------- */

async function emitReactions(channel: ChannelRow, messageId: string) {
  const summary = await reactionSummary(messageId);
  await emitToChannel(channel, 'reaction:update', {
    channelId: channel.id,
    messageId,
    reactions: summary.map((r) => ({ emoji: r.emoji, count: r.count, users: r.users })),
  });
}

messagesRouter.put('/channels/:channelId/messages/:messageId/reactions/:emoji', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req), P.ADD_REACTIONS);
  const emoji = String(req.params.emoji);
  if (emoji.length === 0 || emoji.length > 32) throw badRequest('Emoji inválido');
  const message = await one('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [req.params.messageId, channel.id]);
  if (!message) throw notFound('Mensagem não encontrada');
  await one('INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [message.id, uid(req), emoji]);
  await emitReactions(channel, message.id);
  res.status(204).end();
});

messagesRouter.delete('/channels/:channelId/messages/:messageId/reactions/:emoji', async (req, res) => {
  const { channel } = await requireChannel(String(req.params.channelId), uid(req));
  await one('DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3', [req.params.messageId, uid(req), req.params.emoji]);
  await emitReactions(channel, String(req.params.messageId));
  res.status(204).end();
});

/* ---------- pins ---------- */

async function setPinned(req: any, pinned: boolean) {
  const { channel, perms } = await requireChannel(String(req.params.channelId), uid(req));
  // In DMs anyone in the conversation may pin; in servers it takes MANAGE_MESSAGES.
  if (channel.server_id && !has(perms, P.MANAGE_MESSAGES)) throw forbidden();
  const row = await one('UPDATE messages SET pinned = $3 WHERE id = $1 AND channel_id = $2 RETURNING id', [req.params.messageId, channel.id, pinned]);
  if (!row) throw notFound('Mensagem não encontrada');
  await emitToChannel(channel, 'message:update', await loadMessage(row.id, uid(req)));
}

messagesRouter.put('/channels/:channelId/pins/:messageId', async (req, res) => { await setPinned(req, true); res.status(204).end(); });
messagesRouter.delete('/channels/:channelId/pins/:messageId', async (req, res) => { await setPinned(req, false); res.status(204).end(); });

/* ---------- search ---------- */

messagesRouter.get('/servers/:serverId/messages/search', async (req, res) => {
  const serverId = String(req.params.serverId);
  const q = z.object({ q: z.string().trim().min(1).max(200), authorId: z.string().uuid().optional() }).parse(req.query);
  const channels = await query<ChannelRow>("SELECT * FROM channels WHERE server_id = $1 AND type IN ('text', 'thread')", [serverId]);
  const visible: string[] = [];
  for (const c of channels) {
    try {
      const { perms } = await requireChannel(c.id, uid(req));
      if (has(perms, P.READ_HISTORY)) visible.push(c.id);
    } catch { /* not visible */ }
  }
  const ids = await query(
    `SELECT id FROM messages WHERE channel_id = ANY($1::uuid[]) AND content ILIKE '%' || $2 || '%'
     AND ($3::uuid IS NULL OR author_id = $3) ORDER BY created_at DESC LIMIT 50`,
    [visible, q.q.replace(/[%_\\]/g, (c) => `\\${c}`), q.authorId ?? null]);
  res.json(await loadMessages(ids.map((r) => r.id), uid(req)));
});
