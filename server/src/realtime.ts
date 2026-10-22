import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from './config.js';
import { query, one } from './db.js';
import { verifyToken } from './auth.js';
import { channelPermissions, getChannel, has, P, type ChannelRow } from './permissions.js';

let io: Server | null = null;

/** Number of open sockets per user; a user is online while this is above zero. */
const connections = new Map<string, number>();

export interface VoiceState {
  userId: string;
  channelId: string;
  serverId: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  streaming: boolean;
}
/** channelId -> userId -> state. Media itself flows through LiveKit; this is only who is where. */
const voiceStates = new Map<string, Map<string, VoiceState>>();

export function initRealtime(httpServer: HttpServer) {
  io = new Server(httpServer, { cors: { origin: config.webOrigin, credentials: true } });

  io.use((socket, next) => {
    try {
      socket.data.userId = verifyToken(String(socket.handshake.auth?.token ?? ''));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => onConnection(socket).catch((err) => console.error('socket setup failed', err)));
  return io;
}

async function onConnection(socket: Socket) {
  const userId: string = socket.data.userId;
  socket.join(`user:${userId}`);
  const servers = await query<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = $1', [userId]);
  for (const s of servers) socket.join(`server:${s.server_id}`);

  const count = (connections.get(userId) ?? 0) + 1;
  connections.set(userId, count);
  if (count === 1) await broadcastPresence(userId);

  socket.emit('ready', {
    voiceStates: [...voiceStates.values()].flatMap((m) => [...m.values()]),
    online: [...connections.keys()],
  });

  socket.on('typing', async ({ channelId }: { channelId: string }) => {
    try {
      const channel = await getChannel(channelId);
      if (!has(await channelPermissions(channel, userId), P.SEND_MESSAGES)) return;
      await emitToChannel(channel, 'typing', { channelId, userId }, userId);
    } catch { /* ignore bad channel ids */ }
  });

  socket.on('voice:update', (patch: Partial<Pick<VoiceState, 'muted' | 'deafened' | 'video' | 'streaming'>>) => {
    for (const states of voiceStates.values()) {
      const state = states.get(userId);
      if (!state) continue;
      for (const key of ['muted', 'deafened', 'video', 'streaming'] as const) {
        if (typeof patch?.[key] === 'boolean') state[key] = patch[key]!;
      }
      emitVoiceState(state, false);
    }
  });

  socket.on('voice:leave', () => leaveVoice(userId));

  socket.on('disconnect', async () => {
    const left = (connections.get(userId) ?? 1) - 1;
    if (left <= 0) {
      connections.delete(userId);
      leaveVoice(userId);
      await broadcastPresence(userId).catch(() => {});
    } else {
      connections.set(userId, left);
    }
  });
}

export const isOnline = (userId: string) => connections.has(userId);

/** Presence other people see: invisible users and users without sockets show as offline. */
export async function visibleStatus(userId: string, stored?: string): Promise<string> {
  if (!isOnline(userId)) return 'offline';
  const status = stored ?? (await one<{ status: string }>('SELECT status FROM users WHERE id = $1', [userId]))?.status;
  return status === 'invisible' ? 'offline' : status ?? 'offline';
}

export async function broadcastPresence(userId: string) {
  if (!io) return;
  const user = await one<{ status: string; custom_status: string }>('SELECT status, custom_status FROM users WHERE id = $1', [userId]);
  if (!user) return;
  const payload = { userId, status: await visibleStatus(userId, user.status), customStatus: user.custom_status };
  const rooms = new Set<string>();
  for (const s of await query('SELECT server_id FROM members WHERE user_id = $1', [userId])) rooms.add(`server:${s.server_id}`);
  for (const f of await query("SELECT target_id FROM relationships WHERE user_id = $1 AND type = 'friend'", [userId])) rooms.add(`user:${f.target_id}`);
  rooms.add(`user:${userId}`);
  io.to([...rooms]).emit('presence', payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToServer(serverId: string, event: string, payload: unknown) {
  io?.to(`server:${serverId}`).emit(event, payload);
}

/** Subscribe or unsubscribe every socket of a user to a server's room (join/leave/kick). */
export function setServerSubscription(userId: string, serverId: string, joined: boolean) {
  if (!io) return;
  const sockets = io.in(`user:${userId}`);
  if (joined) sockets.socketsJoin(`server:${serverId}`);
  else sockets.socketsLeave(`server:${serverId}`);
}

/**
 * Sends an event to everyone who can see the channel. DMs go to recipients; server channels go
 * to the whole server room unless overwrites restrict them, then only to members with VIEW_CHANNEL.
 */
export async function emitToChannel(channel: ChannelRow, event: string, payload: unknown, exceptUserId?: string) {
  if (!io) return;
  if (channel.type === 'dm' || channel.type === 'group_dm') {
    const recipients = await query('SELECT user_id FROM dm_recipients WHERE channel_id = $1', [channel.id]);
    const rooms = recipients.filter((r) => r.user_id !== exceptUserId).map((r) => `user:${r.user_id}`);
    if (rooms.length) io.to(rooms).emit(event, payload);
    return;
  }
  const sourceId = channel.type === 'thread' && channel.parent_id ? channel.parent_id : channel.id;
  const restricted = await one('SELECT 1 FROM overwrites WHERE channel_id = $1 LIMIT 1', [sourceId]);
  if (!restricted) {
    const target = exceptUserId ? io.to(`server:${channel.server_id}`).except(`user:${exceptUserId}`) : io.to(`server:${channel.server_id}`);
    target.emit(event, payload);
    return;
  }
  const members = await query<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = $1', [channel.server_id]);
  const rooms: string[] = [];
  for (const m of members) {
    if (m.user_id === exceptUserId || !isOnline(m.user_id)) continue;
    if (has(await channelPermissions(channel, m.user_id), P.VIEW_CHANNEL)) rooms.push(`user:${m.user_id}`);
  }
  if (rooms.length) io.to(rooms).emit(event, payload);
}

function emitVoiceState(state: VoiceState, left: boolean) {
  const payload = { ...state, left };
  if (state.serverId) emitToServer(state.serverId, 'voice:state', payload);
  else void getChannel(state.channelId).then((c) => emitToChannel(c, 'voice:state', payload)).catch(() => {});
}

export function joinVoice(state: VoiceState) {
  leaveVoice(state.userId);
  let states = voiceStates.get(state.channelId);
  if (!states) voiceStates.set(state.channelId, (states = new Map()));
  states.set(state.userId, state);
  emitVoiceState(state, false);
}

export function leaveVoice(userId: string) {
  for (const [channelId, states] of voiceStates) {
    const state = states.get(userId);
    if (!state) continue;
    states.delete(userId);
    if (states.size === 0) voiceStates.delete(channelId);
    emitVoiceState(state, true);
  }
}

export function voiceStatesFor(channelId: string) {
  return [...(voiceStates.get(channelId)?.values() ?? [])];
}
