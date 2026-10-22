import { io, type Socket } from 'socket.io-client';
import { API_BASE, api, getToken } from './api';
import { addMessage, findChannel, get, patchServer, removeMessage, removeServer, set, updateMessage, upsertMember, upsertRole, upsertServer } from './store';
import type { Channel, Member, Message, Relationship, Role, Server, VoiceState } from './types';
import { notifyForMessage } from './notify';

export let socket: Socket | null = null;

export async function refreshServer(serverId: string) {
  try { upsertServer(await api<Server>(`/servers/${serverId}`)); } catch { removeServer(serverId); }
}

export function connectSocket() {
  socket = io(API_BASE || undefined, { auth: { token: getToken() }, transports: ['websocket'] });

  socket.on('ready', (data: { voiceStates: VoiceState[] }) => {
    const voiceStates: Record<string, VoiceState> = {};
    for (const v of data.voiceStates) voiceStates[v.userId] = v;
    set({ voiceStates });
  });
  // After a reconnect, reload what we may have missed.
  socket.io.on('reconnect', () => { void bootstrap(); });

  socket.on('message:create', (m: Message) => {
    addMessage(m);
    set((s) => {
      const me = s.me?.id;
      const viewing = currentChannelId() === m.channelId && document.hasFocus();
      const rs = s.readStates[m.channelId] ?? { channelId: m.channelId, unread: false, mentions: 0 };
      const mentioned = m.mentionEveryone || (me ? m.mentions.includes(me) : false);
      const channel = findChannel(m.channelId);
      const isDm = channel?.type === 'dm' || channel?.type === 'group_dm';
      const typing = { ...s.typing, [m.channelId]: { ...(s.typing[m.channelId] ?? {}) } };
      delete typing[m.channelId][m.author.id];
      if (m.author.id === me || viewing) return { typing };
      return {
        typing,
        readStates: { ...s.readStates, [m.channelId]: { ...rs, unread: true, mentions: rs.mentions + (mentioned || isDm ? 1 : 0) } },
      };
    });
    if (currentChannelId() === m.channelId && document.hasFocus()) void api(`/channels/${m.channelId}/ack`, { method: 'POST' }).catch(() => {});
    const channel = findChannel(m.channelId);
    if (channel && (channel.type === 'dm' || channel.type === 'group_dm')) {
      set((s) => ({ dms: { ...s.dms, [channel.id]: { ...channel, lastMessageAt: m.createdAt } } }));
    }
    notifyForMessage(m);
  });
  socket.on('message:update', (m: Message) => updateMessage(m));
  socket.on('message:delete', ({ id, channelId }: { id: string; channelId: string }) => removeMessage(channelId, id));
  socket.on('reaction:update', ({ channelId, messageId, reactions }: { channelId: string; messageId: string; reactions: { emoji: string; count: number; users: string[] }[] }) => {
    const me = get().me?.id ?? '';
    set((s) => {
      const list = s.messages[channelId];
      if (!list) return {};
      return {
        messages: {
          ...s.messages,
          [channelId]: list.map((m) => (m.id === messageId ? { ...m, reactions: reactions.map((r) => ({ emoji: r.emoji, count: r.count, me: r.users.includes(me) })) } : m)),
        },
      };
    });
  });

  socket.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
    set((s) => ({ typing: { ...s.typing, [channelId]: { ...(s.typing[channelId] ?? {}), [userId]: Date.now() + 8000 } } }));
  });

  socket.on('presence', ({ userId, status, customStatus }) => {
    set((s) => ({ presence: { ...s.presence, [userId]: { status, customStatus } } }));
  });

  socket.on('server:create', (srv: Server) => upsertServer(srv));
  socket.on('server:update', (srv: Partial<Server> & { id: string }) => patchServer(srv.id, (old) => ({ ...old, ...srv })));
  socket.on('server:delete', ({ id }: { id: string }) => removeServer(id));
  socket.on('server:refresh', ({ serverId }: { serverId: string }) => { void refreshServer(serverId); });
  socket.on('channel:delete', ({ id }: { id: string }) => {
    set((s) => (s.view.kind === 'server' && s.view.channelId === id ? { view: { kind: 'server', serverId: s.view.serverId } } : {}));
  });
  socket.on('member:add', (m: Member) => upsertMember(m));
  socket.on('member:update', (m: Member) => {
    upsertMember(m);
    // Our own roles changed: what we can see may have changed too.
    if (m.user.id === get().me?.id) void refreshServer(m.serverId);
  });
  socket.on('member:remove', ({ serverId, userId }: { serverId: string; userId: string }) => {
    patchServer(serverId, (srv) => ({ ...srv, members: srv.members.filter((m) => m.user.id !== userId) }));
  });
  socket.on('role:update', (r: Role) => { upsertRole(r); void refreshServer(r.serverId); });
  socket.on('role:delete', ({ serverId }: { serverId: string }) => { void refreshServer(serverId); });

  socket.on('thread:create', (t: Channel) => set((s) => ({ threads: { ...s.threads, [t.id]: t } })));

  socket.on('dm:create', (c: Channel) => set((s) => ({ dms: { ...s.dms, [c.id]: c } })));
  socket.on('dm:update', (c: Channel) => set((s) => ({ dms: { ...s.dms, [c.id]: c } })));
  socket.on('dm:delete', ({ id }: { id: string }) => set((s) => {
    const dms = { ...s.dms };
    delete dms[id];
    return { dms, view: s.view.kind === 'home' && s.view.dmId === id ? { kind: 'home' } : s.view };
  }));
  socket.on('relationships', (relationships: Relationship[]) => set({ relationships }));

  socket.on('voice:state', (v: VoiceState & { left: boolean }) => {
    set((s) => {
      const voiceStates = { ...s.voiceStates };
      if (v.left) { if (voiceStates[v.userId]?.channelId === v.channelId) delete voiceStates[v.userId]; }
      else voiceStates[v.userId] = v;
      return { voiceStates };
    });
  });
}

export function currentChannelId(): string | undefined {
  const s = get();
  if (s.openThreadId) return s.openThreadId;
  return s.view.kind === 'home' ? s.view.dmId : s.view.channelId;
}

export async function bootstrap() {
  const [me, servers, dms, relationships, readStates] = await Promise.all([
    api('/users/@me'), api<{ id: string }[]>('/servers'), api<Channel[]>('/dms'), api<Relationship[]>('/relationships'), api<{ channelId: string; unread: boolean; mentions: number }[]>('/read-states'),
  ]);
  const presence: Record<string, any> = { [me.id]: { status: me.status, customStatus: me.customStatus } };
  for (const r of relationships) presence[r.user.id] = { status: r.user.status, customStatus: r.user.customStatus };
  for (const dm of dms) for (const u of dm.recipients ?? []) presence[u.id] = { status: u.status, customStatus: u.customStatus };
  set((s) => ({
    me,
    relationships,
    dms: Object.fromEntries(dms.map((d) => [d.id, d])),
    readStates: Object.fromEntries(readStates.map((r) => [r.channelId, r])),
    presence: { ...s.presence, ...presence },
    // Drop cached history so a reconnect does not show stale messages.
    messages: {},
    hasMore: {},
  }));
  const snapshots = await Promise.all(servers.map((s) => api<Server>(`/servers/${s.id}`)));
  set({ serverOrder: [] });
  for (const snap of snapshots) upsertServer(snap);
}
