import { findChannel, get, memberName, dmName } from './store';
import type { Message } from './types';
import { assetUrl } from './api';
import { usePrefs } from './prefs';
import { playMessage } from './sounds';

const native = (window as any).nexoNative as undefined | {
  notify(n: { title: string; body: string; channelId: string }): void;
  setBadge(count: number): void;
  onNotificationClick(cb: (channelId: string) => void): void;
};

let clickHandler: ((channelId: string) => void) | null = null;

export function onNotificationClick(cb: (channelId: string) => void) {
  clickHandler = cb;
  native?.onNotificationClick(cb);
}

export async function requestNotificationPermission() {
  if (!native && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
}

/**
 * Sound + desktop notification for a new message. DMs always count; servers follow the
 * per-server level (all / mentions / none). Do Not Disturb silences everything.
 */
export function notifyForMessage(m: Message, viewing: boolean) {
  const s = get();
  const me = s.me;
  if (!me || m.author.id === me.id || me.status === 'dnd') return;
  const channel = findChannel(m.channelId);
  if (!channel) return;
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const mentioned = m.mentionEveryone || m.mentions.includes(me.id);
  const prefs = usePrefs.getState();
  if (!isDm) {
    const serverId = channel.serverId ?? findChannel(channel.parentId ?? undefined)?.serverId;
    const level = (serverId && prefs.serverNotify[serverId]) || 'all';
    if (level === 'none' || (level === 'mentions' && !mentioned)) return;
  }
  if (viewing) return;
  playMessage();
  if (document.hasFocus() || !prefs.desktopNotifications) return;
  const author = memberName(channel.serverId, m.author);
  const title = isDm ? (channel.type === 'dm' ? author : `${author} em ${dmName(channel, me.id)}`) : `${author} (#${channel.name})`;
  const body = m.content.replace(/<@([0-9a-f-]{36})>/g, '@…').slice(0, 200) || 'Enviou um anexo';
  if (native) return native.notify({ title, body, channelId: channel.id });
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: assetUrl(m.author.avatarUrl) || undefined, tag: channel.id, silent: true });
    n.onclick = () => { window.focus(); clickHandler?.(channel.id); };
  }
}

/** System notification for an incoming call while the window is in the background. */
export function notifyIncomingCall(channelId: string, callerName: string) {
  if (document.hasFocus() || get().me?.status === 'dnd' || !usePrefs.getState().desktopNotifications) return;
  const title = `${callerName} está te ligando`;
  const body = 'Abra o Nexo para atender';
  if (native) return native.notify({ title, body, channelId });
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, tag: `call:${channelId}`, requireInteraction: true });
    n.onclick = () => { window.focus(); clickHandler?.(channelId); };
  }
}

export function updateBadge(count: number) {
  native?.setBadge(count);
  document.title = count > 0 ? `(${count}) Nexo` : 'Nexo';
}
