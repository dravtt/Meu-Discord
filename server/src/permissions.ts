import { one, query, type Queryable, pool } from './db.js';
import { forbidden, notFound } from './errors.js';

export const P = {
  VIEW_CHANNEL: 1 << 0,
  SEND_MESSAGES: 1 << 1,
  READ_HISTORY: 1 << 2,
  ADD_REACTIONS: 1 << 3,
  ATTACH_FILES: 1 << 4,
  MENTION_EVERYONE: 1 << 5,
  MANAGE_MESSAGES: 1 << 6,
  MANAGE_CHANNELS: 1 << 7,
  MANAGE_SERVER: 1 << 8,
  MANAGE_ROLES: 1 << 9,
  KICK_MEMBERS: 1 << 10,
  BAN_MEMBERS: 1 << 11,
  CREATE_INVITE: 1 << 12,
  CHANGE_NICKNAME: 1 << 13,
  MANAGE_NICKNAMES: 1 << 14,
  CONNECT: 1 << 15,
  SPEAK: 1 << 16,
  VIDEO: 1 << 17,
  MUTE_MEMBERS: 1 << 18,
  CREATE_THREADS: 1 << 19,
  ADMINISTRATOR: 1 << 30,
} as const;

export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0);

export const DEFAULT_EVERYONE_PERMISSIONS =
  P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_HISTORY | P.ADD_REACTIONS | P.ATTACH_FILES |
  P.CREATE_INVITE | P.CHANGE_NICKNAME | P.CONNECT | P.SPEAK | P.VIDEO | P.CREATE_THREADS;

export const has = (perms: number, flag: number) => (perms & P.ADMINISTRATOR) !== 0 || (perms & flag) === flag;

/** Server-level permissions of a member: owner gets everything, otherwise OR of @everyone and their roles. */
export async function serverPermissions(serverId: string, userId: string, db: Queryable = pool): Promise<number | null> {
  const server = await one<{ owner_id: string }>('SELECT owner_id FROM servers WHERE id = $1', [serverId], db);
  if (!server) return null;
  const member = await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [serverId, userId], db);
  if (!member) return null;
  if (server.owner_id === userId) return ALL_PERMISSIONS;
  const rows = await query<{ permissions: number }>(
    `SELECT r.permissions FROM roles r
     WHERE r.server_id = $1 AND (r.is_default OR r.id IN (SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2))`,
    [serverId, userId], db);
  const perms = rows.reduce((acc, r) => acc | r.permissions, 0);
  return perms & P.ADMINISTRATOR ? ALL_PERMISSIONS : perms;
}

export interface ChannelRow {
  id: string;
  server_id: string | null;
  parent_id: string | null;
  type: string;
  name: string;
  topic: string;
  position: number;
  owner_id: string | null;
}

/**
 * Effective permissions in a channel. Order: @everyone overwrite, then role overwrites
 * (deny then allow, combined), then the member's own overwrite. Threads inherit from their parent.
 */
export async function channelPermissions(channel: ChannelRow, userId: string, db: Queryable = pool): Promise<number> {
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    const member = await one('SELECT 1 FROM dm_recipients WHERE channel_id = $1 AND user_id = $2', [channel.id, userId], db);
    if (!member) return 0;
    return P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_HISTORY | P.ADD_REACTIONS | P.ATTACH_FILES | P.CONNECT | P.SPEAK | P.VIDEO |
      (channel.owner_id === userId ? P.MANAGE_CHANNELS : 0);
  }
  const base = await serverPermissions(channel.server_id!, userId, db);
  if (base === null) return 0;
  if (base & P.ADMINISTRATOR) return ALL_PERMISSIONS;

  const sourceId = channel.type === 'thread' && channel.parent_id ? channel.parent_id : channel.id;
  const overwrites = await query<{ target_id: string; target_type: string; allow: number; deny: number }>(
    'SELECT target_id, target_type, allow, deny FROM overwrites WHERE channel_id = $1', [sourceId], db);
  if (overwrites.length === 0) return base;

  const everyone = await one<{ id: string }>('SELECT id FROM roles WHERE server_id = $1 AND is_default', [channel.server_id], db);
  const roleIds = new Set((await query<{ role_id: string }>(
    'SELECT role_id FROM member_roles WHERE server_id = $1 AND user_id = $2', [channel.server_id, userId], db)).map((r) => r.role_id));

  let perms = base;
  const ev = overwrites.find((o) => o.target_type === 'role' && o.target_id === everyone?.id);
  if (ev) perms = (perms & ~ev.deny) | ev.allow;
  let allow = 0, deny = 0;
  for (const o of overwrites) {
    if (o.target_type === 'role' && roleIds.has(o.target_id)) { allow |= o.allow; deny |= o.deny; }
  }
  perms = (perms & ~deny) | allow;
  const own = overwrites.find((o) => o.target_type === 'member' && o.target_id === userId);
  if (own) perms = (perms & ~own.deny) | own.allow;
  return perms;
}

export async function getChannel(channelId: string, db: Queryable = pool): Promise<ChannelRow> {
  const channel = await one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId], db);
  if (!channel) throw notFound('Canal não encontrado');
  return channel;
}

/** Loads a channel and throws unless the user has every given permission there. */
export async function requireChannel(channelId: string, userId: string, ...flags: number[]) {
  const channel = await getChannel(channelId);
  const perms = await channelPermissions(channel, userId);
  if (!has(perms, P.VIEW_CHANNEL)) throw notFound('Canal não encontrado');
  for (const flag of flags) if (!has(perms, flag)) throw forbidden();
  return { channel, perms };
}

export async function requireServer(serverId: string, userId: string, ...flags: number[]) {
  const perms = await serverPermissions(serverId, userId);
  if (perms === null) throw notFound('Servidor não encontrado');
  for (const flag of flags) if (!has(perms, flag)) throw forbidden();
  return perms;
}

/** Highest role position of a member (owner is above everyone). Used for role hierarchy checks. */
export async function topRolePosition(serverId: string, userId: string): Promise<number> {
  const server = await one<{ owner_id: string }>('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (server?.owner_id === userId) return Number.MAX_SAFE_INTEGER;
  const row = await one<{ max: number | null }>(
    `SELECT max(r.position) AS max FROM roles r JOIN member_roles mr ON mr.role_id = r.id
     WHERE mr.server_id = $1 AND mr.user_id = $2`, [serverId, userId]);
  return row?.max ?? 0;
}
