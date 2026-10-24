import { Router } from 'express';
import { z } from 'zod';
import { one, query, transaction } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { channelPermissions, DEFAULT_EVERYONE_PERMISSIONS, has, P, requireServer, topRolePosition, type ChannelRow } from '../permissions.js';
import { emitToServer, emitToUser, setServerSubscription, voiceStatesFor } from '../realtime.js';
import { getPublicUser, serializeChannel, serializeRole } from '../serializers.js';
import { assertServerSlot, rateLimit, spamGuard } from '../guard.js';

export const serversRouter = Router();
serversRouter.use(requireAuth);

function serializeServer(s: any) {
  return { id: s.id, name: s.name, iconUrl: s.icon_url, ownerId: s.owner_id, createdAt: s.created_at, nsfw: !!s.nsfw };
}

export async function memberPayload(serverId: string, userId: string) {
  const m = await one('SELECT * FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  if (!m) return null;
  const roles = await query('SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  return { serverId, user: await getPublicUser(userId), nickname: m.nickname, joinedAt: m.joined_at, roleIds: roles.map((r) => r.role_id) };
}

/** Full server snapshot for one viewer: only channels they can see, plus their own permissions. */
export async function serverSnapshot(serverId: string, userId: string) {
  const server = await one('SELECT * FROM servers WHERE id = $1', [serverId]);
  if (!server) return null;
  const perms = await requireServer(serverId, userId);
  const channels = await query<ChannelRow>("SELECT * FROM channels WHERE server_id = $1 AND type <> 'thread' ORDER BY position, created_at", [serverId]);
  const visible: (ReturnType<typeof serializeChannel> & { permissions: number })[] = [];
  for (const c of channels) {
    const cp = await channelPermissions(c, userId);
    if (c.type === 'category' || has(cp, P.VIEW_CHANNEL)) visible.push({ ...serializeChannel(c), permissions: cp });
  }
  // Hide categories with no visible children unless the viewer can manage channels.
  const shown = visible.filter((c) => c.type !== 'category' || has(perms, P.MANAGE_CHANNELS) || visible.some((x) => x.parentId === c.id));
  const roles = await query('SELECT * FROM roles WHERE server_id = $1 ORDER BY position DESC', [serverId]);
  const members = await query('SELECT user_id FROM members WHERE server_id = $1 ORDER BY joined_at', [serverId]);
  const overwrites = has(perms, P.MANAGE_ROLES) || has(perms, P.MANAGE_CHANNELS)
    ? await query('SELECT o.* FROM overwrites o JOIN channels c ON c.id = o.channel_id WHERE c.server_id = $1', [serverId])
    : [];
  return {
    ...serializeServer(server),
    permissions: perms,
    channels: shown,
    roles: roles.map(serializeRole),
    members: await Promise.all(members.map((m) => memberPayload(serverId, m.user_id))),
    overwrites: overwrites.map((o) => ({ channelId: o.channel_id, targetId: o.target_id, targetType: o.target_type, allow: o.allow, deny: o.deny })),
    voiceStates: shown.filter((c) => c.type === 'voice').flatMap((c) => voiceStatesFor(c.id)),
  };
}

serversRouter.get('/servers', async (req, res) => {
  const rows = await query(
    'SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id WHERE m.user_id = $1 ORDER BY m.joined_at', [uid(req)]);
  res.json(rows.map(serializeServer));
});

serversRouter.post('/servers', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(100), iconUrl: z.string().max(500).nullable().optional() }).parse(req.body);
  await spamGuard(uid(req), 'server', {}, () => rateLimit(`server:create:${uid(req)}`, 10, 60 * 60_000, 'Você criou servidores demais em pouco tempo. Tente de novo mais tarde.'));
  await assertServerSlot(uid(req));
  const serverId = await transaction(async (db) => {
    const s = (await db.query('INSERT INTO servers (name, icon_url, owner_id) VALUES ($1, $2, $3) RETURNING id', [body.name, body.iconUrl ?? null, uid(req)])).rows[0];
    await db.query('INSERT INTO members (server_id, user_id) VALUES ($1, $2)', [s.id, uid(req)]);
    await db.query("INSERT INTO roles (server_id, name, permissions, position, is_default) VALUES ($1, '@everyone', $2, 0, true)", [s.id, DEFAULT_EVERYONE_PERMISSIONS]);
    const text = (await db.query("INSERT INTO channels (server_id, type, name, position) VALUES ($1, 'category', 'Canais de texto', 0) RETURNING id", [s.id])).rows[0];
    const voice = (await db.query("INSERT INTO channels (server_id, type, name, position) VALUES ($1, 'category', 'Canais de voz', 1) RETURNING id", [s.id])).rows[0];
    await db.query("INSERT INTO channels (server_id, parent_id, type, name, position) VALUES ($1, $2, 'text', 'geral', 0)", [s.id, text.id]);
    await db.query("INSERT INTO channels (server_id, parent_id, type, name, position) VALUES ($1, $2, 'voice', 'Geral', 0)", [s.id, voice.id]);
    return s.id as string;
  });
  setServerSubscription(uid(req), serverId, true);
  const snapshot = await serverSnapshot(serverId, uid(req));
  emitToUser(uid(req), 'server:create', snapshot);
  res.status(201).json(snapshot);
});

serversRouter.get('/servers/:serverId', async (req, res) => {
  const snapshot = await serverSnapshot(String(req.params.serverId), uid(req));
  if (!snapshot) throw notFound('Servidor não encontrado');
  res.json(snapshot);
});

serversRouter.patch('/servers/:serverId', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.MANAGE_SERVER);
  const body = z.object({ name: z.string().trim().min(2).max(100).optional(), iconUrl: z.string().max(500).nullable().optional(), nsfw: z.boolean().optional() }).parse(req.body);
  const s = await one(
    `UPDATE servers SET name = COALESCE($2, name), icon_url = CASE WHEN $3::boolean THEN $4 ELSE icon_url END, nsfw = COALESCE($5, nsfw) WHERE id = $1 RETURNING *`,
    [serverId, body.name ?? null, body.iconUrl !== undefined, body.iconUrl ?? null, body.nsfw ?? null]);
  emitToServer(serverId, 'server:update', serializeServer(s));
  res.json(serializeServer(s));
});

serversRouter.post('/servers/:serverId/transfer', async (req, res) => {
  const serverId = String(req.params.serverId);
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
  const s = await one('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (!s || s.owner_id !== uid(req)) throw forbidden('Só o dono pode transferir o servidor');
  if (!(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId]))) throw notFound('Membro não encontrado');
  const updated = await one('UPDATE servers SET owner_id = $2 WHERE id = $1 RETURNING *', [serverId, userId]);
  emitToServer(serverId, 'server:update', serializeServer(updated));
  res.json(serializeServer(updated));
});

serversRouter.delete('/servers/:serverId', async (req, res) => {
  const serverId = String(req.params.serverId);
  const s = await one('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (!s) throw notFound('Servidor não encontrado');
  if (s.owner_id !== uid(req)) throw forbidden('Só o dono pode excluir o servidor');
  emitToServer(serverId, 'server:delete', { id: serverId });
  await one('DELETE FROM servers WHERE id = $1', [serverId]);
  res.status(204).end();
});

/* ---------- members ---------- */

serversRouter.patch('/servers/:serverId/members/:userId', async (req, res) => {
  const serverId = String(req.params.serverId);
  const target = req.params.userId === '@me' ? uid(req) : String(req.params.userId);
  const body = z.object({ nickname: z.string().trim().max(32).nullable() }).parse(req.body);
  await requireServer(serverId, uid(req), target === uid(req) ? P.CHANGE_NICKNAME : P.MANAGE_NICKNAMES);
  if (target !== uid(req) && (await topRolePosition(serverId, target)) >= (await topRolePosition(serverId, uid(req)))) throw forbidden('Cargo do membro é igual ou superior ao seu');
  const updated = await one('UPDATE members SET nickname = $3 WHERE server_id = $1 AND user_id = $2 RETURNING 1', [serverId, target, body.nickname || null]);
  if (!updated) throw notFound('Membro não encontrado');
  const payload = await memberPayload(serverId, target);
  emitToServer(serverId, 'member:update', payload);
  res.json(payload);
});

async function removeMember(serverId: string, userId: string, reason: 'leave' | 'kick' | 'ban') {
  await one('DELETE FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId]);
  emitToServer(serverId, 'member:remove', { serverId, userId, reason });
  setServerSubscription(userId, serverId, false);
  emitToUser(userId, 'server:delete', { id: serverId, reason });
}

serversRouter.delete('/servers/:serverId/members/@me', async (req, res) => {
  const serverId = String(req.params.serverId);
  const s = await one('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (!s) throw notFound('Servidor não encontrado');
  if (s.owner_id === uid(req)) throw badRequest('Transfira ou exclua o servidor antes de sair');
  await removeMember(serverId, uid(req), 'leave');
  res.status(204).end();
});

async function assertCanModerate(serverId: string, actor: string, target: string, flag: number) {
  await requireServer(serverId, actor, flag);
  const s = await one('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (target === actor || target === s.owner_id) throw forbidden();
  if ((await topRolePosition(serverId, target)) >= (await topRolePosition(serverId, actor))) throw forbidden('Cargo do membro é igual ou superior ao seu');
}

serversRouter.delete('/servers/:serverId/members/:userId', async (req, res) => {
  const serverId = String(req.params.serverId), target = String(req.params.userId);
  await assertCanModerate(serverId, uid(req), target, P.KICK_MEMBERS);
  if (!(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, target]))) throw notFound('Membro não encontrado');
  await removeMember(serverId, target, 'kick');
  res.status(204).end();
});

serversRouter.get('/servers/:serverId/bans', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.BAN_MEMBERS);
  const bans = await query('SELECT user_id, reason, created_at FROM bans WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
  res.json(await Promise.all(bans.map(async (b) => ({ user: await getPublicUser(b.user_id), reason: b.reason, createdAt: b.created_at }))));
});

serversRouter.put('/servers/:serverId/bans/:userId', async (req, res) => {
  const serverId = String(req.params.serverId), target = String(req.params.userId);
  const { reason } = z.object({ reason: z.string().max(512).default('') }).parse(req.body ?? {});
  await assertCanModerate(serverId, uid(req), target, P.BAN_MEMBERS);
  await one('INSERT INTO bans (server_id, user_id, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [serverId, target, reason]);
  if (await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, target])) await removeMember(serverId, target, 'ban');
  res.status(204).end();
});

serversRouter.delete('/servers/:serverId/bans/:userId', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.BAN_MEMBERS);
  await one('DELETE FROM bans WHERE server_id = $1 AND user_id = $2', [serverId, req.params.userId]);
  res.status(204).end();
});

/* ---------- roles ---------- */

const roleBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  permissions: z.number().int().nonnegative().optional(),
  hoist: z.boolean().optional(),
  position: z.number().int().min(1).optional(),
});

/** You can only grant permissions you have and only touch roles below your highest role. */
async function assertRoleEditable(serverId: string, actor: string, role: any | null, permissions?: number) {
  const perms = await requireServer(serverId, actor, P.MANAGE_ROLES);
  if (permissions !== undefined && (permissions & ~perms) !== 0) throw forbidden('Você não pode conceder permissões que não tem');
  if (role && !role.is_default && role.position >= (await topRolePosition(serverId, actor))) throw forbidden('Cargo igual ou superior ao seu');
}

serversRouter.post('/servers/:serverId/roles', async (req, res) => {
  const serverId = String(req.params.serverId);
  const body = roleBody.parse(req.body);
  await assertRoleEditable(serverId, uid(req), null, body.permissions);
  const top = await one<{ max: number }>('SELECT coalesce(max(position), 0) AS max FROM roles WHERE server_id = $1', [serverId]);
  const role = await one(
    'INSERT INTO roles (server_id, name, color, permissions, hoist, position) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [serverId, body.name ?? 'novo cargo', body.color ?? '#99aab5', body.permissions ?? 0, body.hoist ?? false, top!.max + 1]);
  emitToServer(serverId, 'role:update', serializeRole(role));
  res.status(201).json(serializeRole(role));
});

serversRouter.patch('/servers/:serverId/roles/:roleId', async (req, res) => {
  const serverId = String(req.params.serverId);
  const body = roleBody.parse(req.body);
  const role = await one('SELECT * FROM roles WHERE id = $1 AND server_id = $2', [req.params.roleId, serverId]);
  if (!role) throw notFound('Cargo não encontrado');
  await assertRoleEditable(serverId, uid(req), role, body.permissions);
  if (role.is_default && (body.name || body.position)) throw badRequest('O cargo @everyone não pode ser renomeado nem movido');
  const updated = await one(
    `UPDATE roles SET name = COALESCE($2, name), color = COALESCE($3, color), permissions = COALESCE($4, permissions),
       hoist = COALESCE($5, hoist), position = COALESCE($6, position) WHERE id = $1 RETURNING *`,
    [role.id, body.name ?? null, body.color ?? null, body.permissions ?? null, body.hoist ?? null, body.position ?? null]);
  emitToServer(serverId, 'role:update', serializeRole(updated));
  res.json(serializeRole(updated));
});

serversRouter.delete('/servers/:serverId/roles/:roleId', async (req, res) => {
  const serverId = String(req.params.serverId);
  const role = await one('SELECT * FROM roles WHERE id = $1 AND server_id = $2', [req.params.roleId, serverId]);
  if (!role) throw notFound('Cargo não encontrado');
  if (role.is_default) throw badRequest('O cargo @everyone não pode ser excluído');
  await assertRoleEditable(serverId, uid(req), role);
  await one('DELETE FROM roles WHERE id = $1', [role.id]);
  await one('DELETE FROM overwrites WHERE target_id = $1', [role.id]);
  emitToServer(serverId, 'role:delete', { serverId, id: role.id });
  res.status(204).end();
});

serversRouter.put('/servers/:serverId/members/:userId/roles/:roleId', async (req, res) => {
  const serverId = String(req.params.serverId), target = String(req.params.userId);
  const role = await one('SELECT * FROM roles WHERE id = $1 AND server_id = $2 AND NOT is_default', [req.params.roleId, serverId]);
  if (!role) throw notFound('Cargo não encontrado');
  await assertRoleEditable(serverId, uid(req), role);
  if (!(await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, target]))) throw notFound('Membro não encontrado');
  await one('INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [serverId, target, role.id]);
  const payload = await memberPayload(serverId, target);
  emitToServer(serverId, 'member:update', payload);
  res.json(payload);
});

serversRouter.delete('/servers/:serverId/members/:userId/roles/:roleId', async (req, res) => {
  const serverId = String(req.params.serverId), target = String(req.params.userId);
  const role = await one('SELECT * FROM roles WHERE id = $1 AND server_id = $2', [req.params.roleId, serverId]);
  if (!role) throw notFound('Cargo não encontrado');
  await assertRoleEditable(serverId, uid(req), role);
  await one('DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2 AND role_id = $3', [serverId, target, role.id]);
  const payload = await memberPayload(serverId, target);
  emitToServer(serverId, 'member:update', payload);
  res.json(payload);
});
