import { create } from 'zustand';
import type { Channel, Member, Message, ReadState, Relationship, Role, Server, Status, User, VoiceState } from './types';

export type View = { kind: 'home'; dmId?: string } | { kind: 'server'; serverId: string; channelId?: string };

interface State {
  me: User | null;
  servers: Record<string, Server>;
  serverOrder: string[];
  dms: Record<string, Channel>;
  relationships: Relationship[];
  /** Messages by channel id, oldest first. */
  messages: Record<string, Message[]>;
  /** Whether older history exists beyond what is loaded. */
  hasMore: Record<string, boolean>;
  readStates: Record<string, ReadState>;
  presence: Record<string, { status: Status; customStatus: string }>;
  voiceStates: Record<string, VoiceState>;
  typing: Record<string, Record<string, number>>;
  threads: Record<string, Channel>;
  view: View;
  showMembers: boolean;
  replyTo: Record<string, Message | null>;
  editing: string | null;
  openThreadId: string | null;
}

export const useStore = create<State>(() => ({
  me: null,
  servers: {},
  serverOrder: [],
  dms: {},
  relationships: [],
  messages: {},
  hasMore: {},
  readStates: {},
  presence: {},
  voiceStates: {},
  typing: {},
  threads: {},
  view: { kind: 'home' },
  showMembers: true,
  replyTo: {},
  editing: null,
  openThreadId: null,
}));

export const set = useStore.setState;
export const get = useStore.getState;

export function upsertServer(server: Server) {
  set((s) => {
    const voiceStates = { ...s.voiceStates };
    for (const v of server.voiceStates ?? []) voiceStates[v.userId] = v;
    const presence = { ...s.presence };
    for (const m of server.members) presence[m.user.id] = { status: m.user.status, customStatus: m.user.customStatus };
    return {
      servers: { ...s.servers, [server.id]: server },
      serverOrder: s.serverOrder.includes(server.id) ? s.serverOrder : [...s.serverOrder, server.id],
      voiceStates,
      presence,
    };
  });
}

export function removeServer(id: string) {
  set((s) => {
    const servers = { ...s.servers };
    delete servers[id];
    const view = s.view.kind === 'server' && s.view.serverId === id ? { kind: 'home' as const } : s.view;
    return { servers, serverOrder: s.serverOrder.filter((x) => x !== id), view };
  });
}

export function patchServer(id: string, fn: (server: Server) => Server) {
  set((s) => (s.servers[id] ? { servers: { ...s.servers, [id]: fn(s.servers[id]) } } : {}));
}

export function upsertMember(member: Member) {
  patchServer(member.serverId, (srv) => ({
    ...srv,
    members: srv.members.some((m) => m.user.id === member.user.id)
      ? srv.members.map((m) => (m.user.id === member.user.id ? member : m))
      : [...srv.members, member],
  }));
  set((s) => ({ presence: { ...s.presence, [member.user.id]: { status: member.user.status, customStatus: member.user.customStatus } } }));
}

export function upsertRole(role: Role) {
  patchServer(role.serverId, (srv) => ({
    ...srv,
    roles: (srv.roles.some((r) => r.id === role.id) ? srv.roles.map((r) => (r.id === role.id ? role : r)) : [...srv.roles, role])
      .sort((a, b) => b.position - a.position),
  }));
}

export function addMessage(message: Message) {
  set((s) => {
    const list = s.messages[message.channelId];
    if (!list) return {};
    // Replace an optimistic copy or a duplicate.
    const filtered = list.filter((m) => m.id !== message.id && !(m.pending && m.author.id === message.author.id && m.content === message.content));
    return { messages: { ...s.messages, [message.channelId]: [...filtered, message] } };
  });
}

export function updateMessage(message: Message) {
  set((s) => {
    const list = s.messages[message.channelId];
    if (!list) return {};
    // Reactions' `me` is per viewer, so keep ours rather than the sender's view.
    return { messages: { ...s.messages, [message.channelId]: list.map((m) => (m.id === message.id ? { ...message, reactions: m.reactions } : m)) } };
  });
}

export function removeMessage(channelId: string, id: string) {
  set((s) => {
    const list = s.messages[channelId];
    return list ? { messages: { ...s.messages, [channelId]: list.filter((m) => m.id !== id) } } : {};
  });
}

/** Finds a channel anywhere: server channels, DMs or threads. */
export function findChannel(id: string | undefined): Channel | undefined {
  if (!id) return undefined;
  const s = get();
  if (s.dms[id]) return s.dms[id];
  if (s.threads[id]) return s.threads[id];
  for (const srv of Object.values(s.servers)) {
    const c = srv.channels.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

export function statusOf(userId: string): Status {
  return get().presence[userId]?.status ?? 'offline';
}

export function memberName(serverId: string | null | undefined, user: User) {
  if (!serverId) return user.displayName;
  const m = get().servers[serverId]?.members.find((x) => x.user.id === user.id);
  return m?.nickname || user.displayName;
}

/** Color of a member's highest colored role, if any. */
export function memberColor(serverId: string | null | undefined, userId: string): string | undefined {
  if (!serverId) return undefined;
  const srv = get().servers[serverId];
  const member = srv?.members.find((m) => m.user.id === userId);
  if (!srv || !member) return undefined;
  const role = srv.roles.filter((r) => member.roleIds.includes(r.id) && r.color !== '#99aab5').sort((a, b) => b.position - a.position)[0];
  return role?.color;
}

export function dmName(channel: Channel, meId: string | undefined) {
  if (channel.name) return channel.name;
  const others = (channel.recipients ?? []).filter((u) => u.id !== meId);
  return others.map((u) => u.displayName).join(', ') || 'Conversa';
}

/** Someone changed their profile: refresh every copy of them we hold (members, friends, DMs, loaded messages). */
export function applyUserUpdate(u: User) {
  set((s) => {
    const merge = (old: User) => (old.id === u.id ? { ...old, ...u, status: old.status } : old);
    const servers = { ...s.servers };
    for (const [id, srv] of Object.entries(servers)) {
      if (srv.members.some((m) => m.user.id === u.id)) servers[id] = { ...srv, members: srv.members.map((m) => ({ ...m, user: merge(m.user) })) };
    }
    const dms = { ...s.dms };
    for (const [id, c] of Object.entries(dms)) {
      if (c.recipients?.some((r) => r.id === u.id)) dms[id] = { ...c, recipients: c.recipients.map(merge) };
    }
    const messages = { ...s.messages };
    for (const [id, list] of Object.entries(messages)) {
      if (list.some((m) => m.author.id === u.id)) messages[id] = list.map((m) => (m.author.id === u.id ? { ...m, author: merge(m.author) } : m));
    }
    return {
      me: s.me?.id === u.id ? { ...s.me, ...u, status: s.me.status } : s.me,
      servers, dms, messages,
      relationships: s.relationships.some((r) => r.user.id === u.id) ? s.relationships.map((r) => ({ ...r, user: merge(r.user) })) : s.relationships,
    };
  });
}
