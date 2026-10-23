import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { one } from '../db.js';
import { markVerified, requireAuth, signToken, uid } from '../auth.js';
import { HttpError, notFound } from '../errors.js';
import { USER_COLUMNS, publicUser, type UserRow } from '../serializers.js';
import { broadcastPresence, broadcastUserUpdate } from '../realtime.js';
import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { ageOn, assertDeliverableEmail, clearLimit, rateLimit } from '../guard.js';
import { sendVerificationCode } from '../mail.js';

export const authRouter = Router();

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{2,32}$/, 'Use 2 a 32 letras minúsculas, números, _ ou .');
const password = z.string().min(8).max(128);

const email = z.string().trim().toLowerCase().max(254).email('Digite um e-mail válido');
const birthdate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe sua data de nascimento')
  .refine((d) => { const t = new Date(d); return !Number.isNaN(t.getTime()) && t.getUTCFullYear() > 1900 && t < new Date(); }, 'Data de nascimento inválida');
const MIN_AGE = 13;
const CODE_TTL_MS = 15 * 60 * 1000;
const USERNAME_COOLDOWN_DAYS = 14;

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

async function sendCode(userId: string, to: string, name: string) {
  const code = newCode();
  await one('UPDATE users SET email_code = $2, email_code_expires = now() + $3::interval, email_code_tries = 0 WHERE id = $1', [userId, code, `${CODE_TTL_MS / 1000} seconds`]);
  await sendVerificationCode(to, name, code);
}

authRouter.post('/auth/register', async (req, res) => {
  rateLimit(`register:${req.ip}`, 5, 60 * 60 * 1000, 'Muitas contas criadas daqui. Tente de novo mais tarde.');
  const body = z.object({ username, password, email, birthdate, displayName: z.string().trim().min(1).max(32).optional() }).parse(req.body);
  if (ageOn(body.birthdate) < MIN_AGE) throw new HttpError(400, `Você precisa ter pelo menos ${MIN_AGE} anos para usar o Voka.`);
  if (await one('SELECT 1 FROM users WHERE username = $1', [body.username])) throw new HttpError(409, 'Esse nome de usuário já está em uso');
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1', [body.email])) throw new HttpError(409, 'Já existe uma conta com esse e-mail');
  await assertDeliverableEmail(body.email);
  const hash = await bcrypt.hash(body.password, 10);
  const user = await one<UserRow>(
    `INSERT INTO users (username, display_name, password_hash, email, email_verified, birthdate) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${USER_COLUMNS}`,
    [body.username, body.displayName ?? body.username, hash, body.email, !config.emailVerification, body.birthdate]);
  if (config.emailVerification) await sendCode(user!.id, body.email, user!.display_name);
  res.status(201).json({ token: signToken(user!.id), user: await publicUser(user!) });
});

authRouter.post('/auth/login', async (req, res) => {
  const body = z.object({ username: z.string().trim().toLowerCase().min(1).max(254), password: z.string() }).parse(req.body);
  const key = `login:${req.ip}:${body.username}`;
  rateLimit(key, 10, 15 * 60 * 1000, 'Muitas tentativas de login. Espere 15 minutos e tente de novo.');
  // Log in with the username or the e-mail.
  const user = await one<UserRow & { password_hash: string }>(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = $1 OR lower(email) = $1`, [body.username]);
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) throw new HttpError(401, 'Usuário ou senha incorretos');
  clearLimit(key);
  res.json({ token: signToken(user.id), user: await publicUser(user) });
});

/* ---------- e-mail verification ---------- */

authRouter.post('/users/@me/email/verify', requireAuth, async (req, res) => {
  const { code } = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 números') }).parse(req.body);
  const u = await one<{ email_code: string | null; email_code_expires: Date | null; email_code_tries: number; email_verified: boolean }>(
    'SELECT email_code, email_code_expires, email_code_tries, email_verified FROM users WHERE id = $1', [uid(req)]);
  if (!u) throw notFound();
  if (u.email_verified) return void res.json({ ok: true });
  if (!u.email_code || !u.email_code_expires || u.email_code_expires < new Date()) throw new HttpError(400, 'O código expirou. Peça um novo.');
  if (u.email_code_tries >= 5) throw new HttpError(429, 'Muitas tentativas. Peça um código novo.');
  if (u.email_code !== code) {
    await one('UPDATE users SET email_code_tries = email_code_tries + 1 WHERE id = $1', [uid(req)]);
    throw new HttpError(400, 'Código incorreto');
  }
  await one('UPDATE users SET email_verified = true, email_code = NULL, email_code_expires = NULL WHERE id = $1', [uid(req)]);
  markVerified(uid(req));
  res.json({ ok: true });
});

authRouter.post('/users/@me/email/resend', requireAuth, async (req, res) => {
  rateLimit(`resend:${uid(req)}`, 1, 60 * 1000, 'Espere 1 minuto para pedir outro código.');
  rateLimit(`resend-h:${uid(req)}`, 6, 60 * 60 * 1000, 'Você pediu códigos demais. Tente daqui a uma hora.');
  const u = await one<{ email: string | null; email_verified: boolean; display_name: string }>('SELECT email, email_verified, display_name FROM users WHERE id = $1', [uid(req)]);
  if (!u?.email || u.email_verified) return void res.json({ ok: true });
  await sendCode(uid(req), u.email, u.display_name);
  res.json({ ok: true });
});

/** While unverified, a typo in the e-mail can be fixed. */
authRouter.put('/users/@me/email', requireAuth, async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const u = await one<{ email_verified: boolean; display_name: string }>('SELECT email_verified, display_name FROM users WHERE id = $1', [uid(req)]);
  if (!u) throw notFound();
  if (u.email_verified) throw new HttpError(400, 'Seu e-mail já foi confirmado.');
  rateLimit(`email-change:${uid(req)}`, 5, 60 * 60 * 1000);
  if (await one('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [body.email, uid(req)])) throw new HttpError(409, 'Já existe uma conta com esse e-mail');
  await assertDeliverableEmail(body.email);
  await one('UPDATE users SET email = $2 WHERE id = $1', [uid(req), body.email]);
  await sendCode(uid(req), body.email, u.display_name);
  res.json({ email: body.email });
});

/* ---------- username, birth date ---------- */

authRouter.put('/users/@me/username', requireAuth, async (req, res) => {
  const body = z.object({ username, password: z.string() }).parse(req.body);
  const u = await one<{ password_hash: string; username: string; username_changed_at: Date | null }>('SELECT password_hash, username, username_changed_at FROM users WHERE id = $1', [uid(req)]);
  if (!u || !(await bcrypt.compare(body.password, u.password_hash))) throw new HttpError(400, 'Senha incorreta');
  if (body.username === u.username) return void res.json({ username: u.username });
  const next = u.username_changed_at ? new Date(u.username_changed_at.getTime() + USERNAME_COOLDOWN_DAYS * 86400000) : null;
  if (next && next > new Date()) throw new HttpError(429, `Você só pode mudar o nome de usuário a cada ${USERNAME_COOLDOWN_DAYS} dias. Próxima troca liberada em ${next.toLocaleDateString('pt-BR')}.`);
  if (await one('SELECT 1 FROM users WHERE username = $1', [body.username])) throw new HttpError(409, 'Esse nome de usuário já está em uso');
  const user = await one<UserRow>(`UPDATE users SET username = $2, username_changed_at = now() WHERE id = $1 RETURNING ${USER_COLUMNS}`, [uid(req), body.username]);
  const pub = await publicUser(user!);
  await broadcastUserUpdate(uid(req), pub);
  res.json({ username: body.username, usernameChangedAt: new Date() });
});

/** Older accounts were created without a birth date; it can be set once. */
authRouter.put('/users/@me/birthdate', requireAuth, async (req, res) => {
  const body = z.object({ birthdate }).parse(req.body);
  const u = await one<{ birthdate: Date | null }>('SELECT birthdate FROM users WHERE id = $1', [uid(req)]);
  if (u?.birthdate) throw new HttpError(400, 'A data de nascimento já foi informada e não pode ser mudada.');
  await one('UPDATE users SET birthdate = $2 WHERE id = $1', [uid(req), body.birthdate]);
  res.json({ birthdate: body.birthdate });
});

/* ---------- activity ("Jogando …") ---------- */

authRouter.put('/users/@me/activity', requireAuth, async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(1).max(60),
    steamId: z.number().int().positive().max(1e8).optional(),
    catalogId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    source: z.enum(['manual', 'auto']).default('manual'),
  }).parse(req.body);
  rateLimit(`activity:${uid(req)}`, 30, 60 * 1000);
  const current = await one<{ activity: { name: string; since: string } | null }>('SELECT activity FROM users WHERE id = $1', [uid(req)]);
  // Same game as before keeps its start time, so "há 2 h" stays right.
  const since = current?.activity?.name === body.name ? current.activity.since : new Date().toISOString();
  const activity = { type: 'playing', ...body, since };
  await one('UPDATE users SET activity = $2 WHERE id = $1', [uid(req), JSON.stringify(activity)]);
  await broadcastPresence(uid(req));
  res.json({ activity });
});

authRouter.delete('/users/@me/activity', requireAuth, async (req, res) => {
  await one('UPDATE users SET activity = NULL WHERE id = $1', [uid(req)]);
  await broadcastPresence(uid(req));
  res.status(204).end();
});

/* ---------- badges ---------- */

/** Badges are earned automatically; people can hide the ones they don't want to show. */
export const BADGES = ['founder', 'pioneer', 'verified', 'server_owner', 'popular', 'gamer'] as const;

async function badgesOf(userId: string) {
  const r = await one<{ founder: boolean; pioneer: boolean; verified: boolean; owner: boolean; friends: number; gamer: boolean; hidden: string[] }>(
    `SELECT u.id = (SELECT id FROM users ORDER BY created_at LIMIT 1) AS founder,
            u.created_at < '2027-01-01' AS pioneer,
            (u.email IS NOT NULL AND u.email_verified) AS verified,
            EXISTS (SELECT 1 FROM servers s WHERE s.owner_id = u.id) AS owner,
            (SELECT count(*)::int FROM relationships r WHERE r.user_id = u.id AND r.type = 'friend') AS friends,
            jsonb_path_exists(u.widgets, '$[*] ? (@.type == "games" || (@.type == "favorite" && @.game != null))') AS gamer,
            u.hidden_badges AS hidden
     FROM users u WHERE u.id = $1`, [userId]);
  if (!r) return { earned: [] as string[], hidden: [] as string[] };
  const earned = [r.founder && 'founder', r.pioneer && 'pioneer', r.verified && 'verified', r.owner && 'server_owner', r.friends >= 10 && 'popular', r.gamer && 'gamer'].filter(Boolean) as string[];
  return { earned, hidden: r.hidden };
}

authRouter.put('/users/@me/badges', requireAuth, async (req, res) => {
  const { hidden } = z.object({ hidden: z.array(z.enum(BADGES)).max(BADGES.length) }).parse(req.body);
  await one('UPDATE users SET hidden_badges = $2 WHERE id = $1', [uid(req), hidden]);
  const b = await badgesOf(uid(req));
  res.json({ badges: b.earned, hiddenBadges: b.hidden });
});

authRouter.get('/users/@me', requireAuth, async (req, res) => {
  const user = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [uid(req)]);
  if (!user) throw notFound();
  // Your own status is the stored preference, even when invisible.
  res.json({ ...(await publicUser(user)), ...(await privateFields(uid(req))), status: user.status });
});

/** What only you see about your own account. */
async function privateFields(userId: string) {
  const x = await one<{ server_order: string[]; widgets: unknown[]; email: string | null; email_verified: boolean; birthdate: Date | null; username_changed_at: Date | null; activity: unknown }>(
    'SELECT server_order, widgets, email, email_verified, birthdate, username_changed_at, activity FROM users WHERE id = $1', [userId]);
  const b = await badgesOf(userId);
  return {
    serverOrder: x?.server_order ?? [], widgets: x?.widgets ?? [],
    email: x?.email ?? null, emailVerified: x?.email_verified ?? true, hasBirthdate: !!x?.birthdate,
    adult: x?.birthdate ? ageOn(x.birthdate) >= 18 : false,
    usernameChangedAt: x?.username_changed_at ?? null, activity: x?.activity ?? null,
    badges: b.earned, hiddenBadges: b.hidden,
  };
}

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
const game = z.object({ name: z.string().trim().min(1).max(60), cover: uploadUrl.nullable(), steamId: z.number().int().positive().max(1e8).optional(), catalogId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional() });
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
  res.json({ ...pub, ...(await privateFields(uid(req))), status: user!.status });
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
  const extra = await one<{ widgets: unknown[]; activity: unknown }>('SELECT widgets, activity FROM users WHERE id = $1', [user.id]);
  const b = await badgesOf(user.id);
  res.json({
    ...(await publicUser(user)), mutualServerIds: mutualServers?.ids ?? [], mutualFriendIds: user.id === uid(req) ? [] : mutualFriends?.ids ?? [],
    note: note?.note ?? '', widgets: extra?.widgets ?? [], badges: b.earned.filter((x) => !b.hidden.includes(x)),
  });
});
