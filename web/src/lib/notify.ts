import { findChannel, get, memberName, dmName } from './store';
import type { Message } from './types';
import { assetUrl } from './api';

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

/** Notifies on DMs and mentions while the window is not focused (DND silences everything). */
export function notifyForMessage(m: Message) {
  const s = get();
  const me = s.me;
  if (!me || m.author.id === me.id || document.hasFocus() || me.status === 'dnd') return;
  const channel = findChannel(m.channelId);
  if (!channel) return;
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  if (!isDm && !m.mentionEveryone && !m.mentions.includes(me.id)) return;
  const author = memberName(channel.serverId, m.author);
  const title = isDm ? (channel.type === 'dm' ? author : `${author} em ${dmName(channel, me.id)}`) : `${author} (#${channel.name})`;
  const body = m.content.replace(/<@([0-9a-f-]{36})>/g, '@…').slice(0, 200) || 'Enviou um anexo';
  if (native) return native.notify({ title, body, channelId: channel.id });
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(title, { body, icon: assetUrl(m.author.avatarUrl) || undefined, tag: channel.id });
    n.onclick = () => { window.focus(); clickHandler?.(channel.id); };
  }
}

export function updateBadge(count: number) {
  native?.setBadge(count);
  document.title = count > 0 ? `(${count}) Nexo` : 'Nexo';
}
