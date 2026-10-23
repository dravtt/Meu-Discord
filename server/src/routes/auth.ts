import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../db.js';
import { requireAuth, signToken, uid } from '../auth.js';
import { HttpError, notFound } from '../errors.js';
import { USER_COLUMNS, publicUser, type UserRow } from '../serializers.js';
import { broadcastPresence, broadcastUserUpdate } from '../realtime.js';

export const authRouter = Router();

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{2,32}$/, 'Use 2 a 32 letras minúsculas, números, _ ou .');
const password = z.string().min(8).max(128);

authRouter.post('/auth/register', async (req, res) => {
  const body = z.object({ username, password, displayName: z.string().trim().min(1).max(32).optional() }).parse(req.body);
  if (await one('SELECT 1 FROM users WHERE username = $1', [body.username])) throw new HttpError(409, 'Nome de usuário já em uso');
  const hash = await bcrypt.hash(body.password, 10);
  const user = await one<UserRow>(
    `INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
    [body.username, body.displayName ?? body.username, hash]);
  res.status(201).json({ token: signToken(user!.id), user: await publicUser(user!) });
});

authRouter.post('/auth/login', async (req, res) => {
  const body = z.object({ username, password: z.string() }).parse(req.body);
  const user = await one<UserRow & { password_hash: string }>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = $1`, [body.username]);
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) throw new HttpError(401, 'Usuário ou senha incorretos');
  res.json({ token: signToken(user.id), user: await publicUser(user) });
});

authRouter.get('/users/@me', requireAuth, async (req, res) => {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [uid(req)]);
  if (!user) throw notFound();
  // Your own status is the stored preference, even when invisible.
  const extra = await one<{ server_order: string[]; widgets: unknown[] }>('SELECT server_order, widgets FROM users WHERE id = $1', [uid(req)]);
  res.json({ ...(await publicUser(user)), status: user.status, serverOrder: extra?.server_order ?? [], widgets: extra?.widgets ?? [] });
});

/** The order of servers in the left rail. */
authRouter.put('/users/@me/server-order', requireAuth, async (req, res) => {
  const { serverIds } = z.object({ serverIds: z.array(z.string().uuid()).max(500) }).parse(req.body);
  await one('UPDATE users SET server_order = $2 WHERE id = $1', [uid(req), serverIds]);
  res.status(204).end();
});

/** A private note about another user. */
authRouter.put('/users/:id/note', requireAuth, async (req, res) => {
  const { note } = z.object({ note: z.string().max(256) }).parse(req.body);
  if (!(await one('SELECT 1 FROM users WHERE id = $1', [req.params.id]))) throw notFound('Usuário não encontrado');
  await one(`INSERT INTO user_notes (user_id, target_id, note) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, target_id) DO UPDATE SET note = $3`, [uid(req), req.params.id, note]);
  res.json({ note });
});

/** Only our own uploaded files (also keeps quotes out of the CSS url() the banner is drawn with). */
const uploadUrl = z.string().max(200).regex(/^\/uploads\/[\w.-]+$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Kept in sync with web/src/lib/nameStyle.ts. */
const NAME_FONTS = ['default', 'rounded', 'serif', 'mono', 'pixel', 'script', 'display', 'future'] as const;
const NAME_EFFECTS = ['solid', 'gradient', 'neon', 'outline'] as const;

/** A game on the mural: its cover is an upload, or Steam's art for `steamId`. */
const game = z.object({ name: z.string().trim().min(1).max(60), cover: uploadUrl.nullable(), steamId: z.number().int().positive().max(1e8).optional() });
/** Profile mural widgets, shown in the order given. */
const widgets = z.array(z.discriminatedUnion('type', [
  z.object({ type: z.literal('favorite'), game: game.nullable(), note: z.string().max(140) }),
  z.object({ type: z.literal('games'), games: z.array(game).max(20) }),
  z.object({ type: z.literal('text'), title: z.string().trim().max(40), text: z.string().max(400) }),
])).max(6);

authRouter.patch('/users/@me', requireAuth, async (req, res) => {
  const body = z.object({
    displayName: z.string().trim().min(1).max(32).optional(),
    avatarUrl: uploadUrl.nullable().optional(),
    bio: z.string().max(190).optional(),
    customStatus: z.string().max(128).optional(),
    status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
    bannerUrl: uploadUrl.nullable().optional(),
    pronouns: z.string().trim().max(40).optional(),
    profileColors: z.array(hexColor).max(2).optional(),
    nameStyle: z.object({
      font: z.enum(NAME_FONTS),
      effect: z.enum(NAME_EFFECTS),
      colors: z.array(hexColor).max(2),
    }).optional(),
    widgets: widgets.optional(),
    currentPassword: z.string().optional(),
    newPassword: password.optional(),
  }).parse(req.body);

  if (body.newPassword) {
    const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [uid(req)]);
    if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, row!.password_hash))) throw new HttpError(400, 'Senha atual incorreta');
    await one('UPDATE users SET password_hash = $2 WHERE id = $1', [uid(req), await bcrypt.hash(body.newPassword, 10)]);
  }
  const user = await one<UserRow>(
    `UPDATE users SET
       display_name = COALESCE($2, display_name),
       avatar_url = CASE WHEN $3::boolean THEN $4 ELSE avatar_url END,
       bio = COALESCE($5, bio),
       custom_status = COALESCE($6, custom_status),
       status = COALESCE($7, status),
       banner_url = CASE WHEN $8::boolean THEN $9 ELSE banner_url END,
       pronouns = COALESCE($10, pronouns),
       profile_colors = COALESCE($11, profile_colors),
       name_font = COALESCE($12, name_font),
       name_effect = COALESCE($13, name_effect),
       name_colors = COALESCE($14, name_colors),
       widgets = COALESCE($15::jsonb, widgets)
     WHERE id = $1 RETURNING ${USER_COLUMNS}, widgets`,
    [uid(req), body.displayName ?? null, body.avatarUrl !== undefined, body.avatarUrl ?? null, body.bio ?? null, body.customStatus ?? null, body.status ?? null,
      body.bannerUrl !== undefined, body.bannerUrl ?? null, body.pronouns ?? null, body.profileColors ?? null,
      body.nameStyle?.font ?? null, body.nameStyle?.effect ?? null, body.nameStyle?.colors ?? null, body.widgets ? JSON.stringify(body.widgets) : null]);
  await broadcastPresence(uid(req));
  const pub = await publicUser(user!);
  await broadcastUserUpdate(uid(req), pub);
  res.json({ ...pub, status: user!.status, widgets: (user as UserRow & { widgets: unknown[] }).widgets });
});

authRouter.get('/users/:id', requireAuth, async (req, res) => {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
  if (!user) throw notFound('Usuário não encontrado');
  const mutualServers = await one<{ ids: string[] }>(
    `SELECT coalesce(array_agg(a.server_id), '{}') AS ids FROM members a JOIN members b ON a.server_id = b.server_id
     WHERE a.user_id = $1 AND b.user_id = $2`, [user.id, uid(req)]);
  const mutualFriends = await one<{ ids: string[] }>(
    `SELECT coalesce(array_agg(a.target_id), '{}') AS ids FROM relationships a JOIN relationships b ON a.target_id = b.target_id
     WHERE a.user_id = $1 AND b.user_id = $2 AND a.type = 'friend' AND b.type = 'friend'`, [user.id, uid(req)]);
  const note = await one<{ note: string }>('SELECT note FROM user_notes WHERE user_id = $1 AND target_id = $2', [uid(req), user.id]);
  const extra = await one<{ widgets: unknown[] }>('SELECT widgets FROM users WHERE id = $1', [user.id]);
  res.json({ ...(await publicUser(user)), mutualServerIds: mutualServers?.ids ?? [], mutualFriendIds: user.id === uid(req) ? [] : mutualFriends?.ids ?? [], note: note?.note ?? '', widgets: extra?.widgets ?? [] });
});
