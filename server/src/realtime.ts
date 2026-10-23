import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config } from './config.js';
import { query, one } from './db.js';
import { verifyToken } from './auth.js';
import { channelPermissions, getChannel, has, overwriteSource, P, type ChannelRow } from './permissions.js';

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

/** How long a DM call rings before it counts as unanswered. */
export const RING_MS = 30_000;
interface Ring { channelId: string; callerId: string; recipients: string[]; declined: Set<string>; timer: NodeJS.Timeout }
/** channelId -> ringing DM call. Starts when someone calls an empty DM, ends when anyone answers. */
const rings = new Map<string, Ring>();

const DISCONNECT_GRACE_MS = Number(process.env.NEXO_DISCONNECT_GRACE_MS ?? 10000);
/** Users whose last socket just closed, waiting out the grace period. */
const goingAway = new Map<string, ReturnType<typeof setTimeout>>();

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

  const returning = goingAway.has(userId);
  clearTimeout(goingAway.get(userId));
  goingAway.delete(userId);
  const count = (connections.get(userId) ?? 0) + 1;
  connections.set(userId, count);
  if (count === 1 && !returning) await broadcastPresence(userId);

  socket.emit('ready', {
    voiceStates: [...voiceStates.values()].flatMap((m) => [...m.values()]),
    online: [...connections.keys()],
    rings: [...rings.values()].filter((r) => r.recipients.includes(userId) && !r.declined.has(userId)).map(ringPayload),
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

  socket.on('disconnect', () => {
    const left = (connections.get(userId) ?? 1) - 1;
    if (left > 0) return void connections.set(userId, left);
    // A page reload drops the socket for a moment. Wait a bit before taking the person out of
    // their call and showing them offline, so a quick reconnect picks up where it left off.
    connections.set(userId, 0);
    clearTimeout(goingAway.get(userId));
    goingAway.set(userId, setTimeout(() => {
      goingAway.delete(userId);
      if ((connections.get(userId) ?? 0) > 0) return;
      connections.delete(userId);
      leaveVoice(userId);
      // Going offline ends whatever game they were playing.
      void query('UPDATE users SET activity = NULL WHERE id = $1', [userId]).then(() => broadcastPresence(userId)).catch(() => {});
    }, DISCONNECT_GRACE_MS));
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
  const user = await one<{ status: string; custom_status: string; activity: unknown }>('SELECT status, custom_status, activity FROM users WHERE id = $1', [userId]);
  if (!user) return;
  const status = await visibleStatus(userId, user.status);
  const payload = { userId, status, customStatus: user.custom_status, activity: status === 'offline' ? null : user.activity ?? null };
  io.to(await audienceOf(userId)).emit('presence', payload);
}

/** Rooms of everyone who can see this user: their servers, friends and themselves. */
async function audienceOf(userId: string, withDms = false) {
  const rooms = new Set<string>();
  for (const s of await query('SELECT server_id FROM members WHERE user_id = $1', [userId])) rooms.add(`server:${s.server_id}`);
  for (const f of await query("SELECT target_id FROM relationships WHERE user_id = $1 AND type = 'friend'", [userId])) rooms.add(`user:${f.target_id}`);
  if (withDms) {
    for (const r of await query('SELECT DISTINCT o.user_id FROM dm_recipients d JOIN dm_recipients o ON o.channel_id = d.channel_id WHERE d.user_id = $1', [userId])) rooms.add(`user:${r.user_id}`);
  }
  rooms.add(`user:${userId}`);
  return [...rooms];
}

/** Tells everyone who can see this user that their profile (name, avatar, banner, style…) changed. */
export async function broadcastUserUpdate(userId: string, user: unknown) {
  if (!io) return;
  io.to(await audienceOf(userId, true)).emit('user:update', user);
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
  const restricted = await one('SELECT 1 FROM overwrites WHERE channel_id = $1 LIMIT 1', [await overwriteSource(channel)]);
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
  const ring = rings.get(state.channelId);
  if (ring && state.userId !== ring.callerId) stopRing(ring, 'answered');
}

export function leaveVoice(userId: string) {
  for (const [channelId, states] of voiceStates) {
    const state = states.get(userId);
    if (!state) continue;
    states.delete(userId);
    if (states.size === 0) {
      voiceStates.delete(channelId);
      const ring = rings.get(channelId);
      if (ring) stopRing(ring, 'cancelled');
    }
    emitVoiceState(state, true);
  }
}

const ringPayload = (r: Ring) => ({ channelId: r.channelId, callerId: r.callerId });

/**
 * Rings everyone else in a DM. Only the first person in an empty DM call rings; joining a call
 * that is already going on is silent.
 */
export function startRing(channelId: string, callerId: string, recipients: string[]) {
  const others = recipients.filter((id) => id !== callerId);
  if (rings.has(channelId) || !others.length) return false;
  const ring: Ring = { channelId, callerId, recipients: others, declined: new Set(), timer: setTimeout(() => stopRing(ring, 'timeout'), RING_MS) };
  rings.set(channelId, ring);
  for (const id of others) emitToUser(id, 'call:ring', ringPayload(ring));
  return true;
}

/** Ends the ringing everywhere: on the callee screens and, unless someone answered, for the caller. */
function stopRing(ring: Ring, reason: 'answered' | 'cancelled' | 'timeout' | 'declined') {
  if (rings.get(ring.channelId) !== ring) return;
  clearTimeout(ring.timer);
  rings.delete(ring.channelId);
  for (const id of [ring.callerId, ...ring.recipients]) emitToUser(id, 'call:stop', { channelId: ring.channelId, reason });
}

/** A callee turns the call down. Their other devices stop ringing; the caller is told. */
export function declineRing(channelId: string, userId: string) {
  const ring = rings.get(channelId);
  if (!ring || !ring.recipients.includes(userId)) return;
  ring.declined.add(userId);
  emitToUser(userId, 'call:stop', { channelId, reason: 'declined' });
  emitToUser(ring.callerId, 'call:declined', { channelId, userId });
  if (ring.recipients.every((id) => ring.declined.has(id))) stopRing(ring, 'declined');
}

/** The call a user is in right now, if any. */
export function voiceStateOf(userId: string) {
  for (const states of voiceStates.values()) {
    const state = states.get(userId);
    if (state) return state;
  }
  return undefined;
}

export function voiceStatesFor(channelId: string) {
  return [...(voiceStates.get(channelId)?.values() ?? [])];
}
