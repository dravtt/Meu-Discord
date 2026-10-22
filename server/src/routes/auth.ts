import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../db.js';
import { requireAuth, signToken, uid } from '../auth.js';
import { HttpError, notFound } from '../errors.js';
import { USER_COLUMNS, publicUser, type UserRow } from '../serializers.js';
import { broadcastPresence } from '../realtime.js';

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
  res.json({ ...(await publicUser(user)), status: user.status });
});

authRouter.patch('/users/@me', requireAuth, async (req, res) => {
  const body = z.object({
    displayName: z.string().trim().min(1).max(32).optional(),
    avatarUrl: z.string().max(500).nullable().optional(),
    bio: z.string().max(190).optional(),
    customStatus: z.string().max(128).optional(),
    status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
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
       status = COALESCE($7, status)
     WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [uid(req), body.displayName ?? null, body.avatarUrl !== undefined, body.avatarUrl ?? null, body.bio ?? null, body.customStatus ?? null, body.status ?? null]);
  await broadcastPresence(uid(req));
  res.json({ ...(await publicUser(user!)), status: user!.status });
});

authRouter.get('/users/:id', requireAuth, async (req, res) => {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
  if (!user) throw notFound('Usuário não encontrado');
  const mutualServers = await one<{ ids: string[] }>(
    `SELECT coalesce(array_agg(a.server_id), '{}') AS ids FROM members a JOIN members b ON a.server_id = b.server_id
     WHERE a.user_id = $1 AND b.user_id = $2`, [user.id, uid(req)]);
  res.json({ ...(await publicUser(user)), mutualServerIds: mutualServers?.ids ?? [] });
});
