import { query, one, type Queryable, pool } from './db.js';
import { visibleStatus } from './realtime.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string;
  custom_status: string;
  status: string;
  created_at: Date;
  banner_url: string | null;
  pronouns: string;
  profile_colors: string[];
  name_font: string;
  name_effect: string;
  name_colors: string[];
  activity?: unknown;
}

export const USER_COLUMNS = 'id, username, display_name, avatar_url, bio, custom_status, status, created_at, banner_url, pronouns, profile_colors, name_font, name_effect, name_colors, activity';

export async function publicUser(u: UserRow) {
  const status = await visibleStatus(u.id, u.status);
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    bio: u.bio,
    customStatus: u.custom_status,
    status,
    createdAt: u.created_at,
    bannerUrl: u.banner_url ?? null,
    pronouns: u.pronouns ?? '',
    profileColors: u.profile_colors ?? [],
    nameStyle: { font: u.name_font ?? 'default', effect: u.name_effect ?? 'solid', colors: u.name_colors ?? [] },
    // What they are playing; hidden while offline or invisible.
    activity: status === 'offline' ? null : u.activity ?? null,
  };
}

export async function getPublicUser(id: string) {
  const u = await one<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return u ? publicUser(u) : null;
}

export function serializeChannel(c: any) {
  return {
    id: c.id,
    serverId: c.server_id,
    parentId: c.parent_id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    position: c.position,
    ownerId: c.owner_id,
    iconUrl: c.icon_url ?? null,
    lastMessageAt: c.last_message_at,
  };
}

export function serializeRole(r: any) {
  return { id: r.id, serverId: r.server_id, name: r.name, color: r.color, permissions: r.permissions, position: r.position, hoist: r.hoist, isDefault: r.is_default };
}

/** Loads messages with author, attachments, reactions (grouped, with `me`), mentions and reply preview. */
export async function loadMessages(ids: string[], viewerId: string, db: Queryable = pool) {
  if (ids.length === 0) return [];
  const rows = await query(
    `SELECT m.*, row_to_json(u) AS author FROM messages m
     JOIN (SELECT ${USER_COLUMNS} FROM users) u ON u.id = m.author_id
     WHERE m.id = ANY($1::uuid[])`, [ids], db);
  const attachments = await query('SELECT * FROM attachments WHERE message_id = ANY($1::uuid[])', [ids], db);
  const reactions = await query(
    `SELECT message_id, emoji, count(*)::int AS count, bool_or(user_id = $2) AS me, min(created_at) AS first
     FROM reactions WHERE message_id = ANY($1::uuid[]) GROUP BY message_id, emoji ORDER BY first`, [ids, viewerId], db);
  const mentions = await query('SELECT message_id, user_id FROM message_mentions WHERE message_id = ANY($1::uuid[])', [ids], db);
  const replyIds = rows.map((r) => r.reply_to_id).filter(Boolean);
  const replies = replyIds.length
    ? await query(`SELECT m.id, m.content, m.author_id, u.display_name FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ANY($1::uuid[])`, [replyIds], db)
    : [];

  const byId = new Map<string, any>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      channelId: r.channel_id,
      author: await publicUser(r.author),
      content: r.content,
      kind: r.kind,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      pinned: r.pinned,
      threadId: r.thread_id,
      mentionEveryone: r.mention_everyone,
      mentions: mentions.filter((m) => m.message_id === r.id).map((m) => m.user_id),
      attachments: attachments.filter((a) => a.message_id === r.id).map((a) => ({ id: a.id, url: a.url, filename: a.filename, size: a.size, contentType: a.content_type })),
      reactions: reactions.filter((x) => x.message_id === r.id).map((x) => ({ emoji: x.emoji, count: x.count, me: x.me })),
      replyTo: (() => {
        if (!r.reply_to_id) return null;
        const p = replies.find((x) => x.id === r.reply_to_id);
        return p ? { id: p.id, content: p.content.slice(0, 200), authorId: p.author_id, authorName: p.display_name } : { id: r.reply_to_id, deleted: true };
      })(),
    });
  }
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export async function loadMessage(id: string, viewerId: string) {
  return (await loadMessages([id], viewerId))[0];
}

/** Reactions are per-viewer (`me`), so broadcasts carry counts plus who toggled; clients compute `me`. */
export async function reactionSummary(messageId: string) {
  return query(
    `SELECT emoji, count(*)::int AS count, array_agg(user_id) AS users, min(created_at) AS first
     FROM reactions WHERE message_id = $1 GROUP BY emoji ORDER BY first`, [messageId]);
}
