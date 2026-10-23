import { findChannel, get, set, useStore, type View } from './store';
import { joinCall, useCall } from './voice';

/**
 * Keeps where you were (open channel and call) in sessionStorage, which survives a page reload
 * but not closing the tab. After a reload the app reopens the same place and rejoins the call.
 */
const KEY = 'nexo:session';

interface Saved { view: View; call: { channelId: string; muted: boolean; deafened: boolean } | null }

function read(): Saved | null {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

function write() {
  if (unloading) return;
  const { channelId, muted, deafened } = useCall.getState();
  const saved: Saved = { view: get().view, call: channelId ? { channelId, muted, deafened } : null };
  try { sessionStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ }
}

/** Set while the page is going away, so the call teardown during unload is not saved as "left". */
export let unloading = false;
window.addEventListener('pagehide', () => { unloading = true; });
window.addEventListener('beforeunload', () => { unloading = true; });

let restored = false;

/** Reopens the channel you were looking at. Call once the servers and DMs are loaded. */
export function restoreView() {
  const saved = read();
  const v = saved?.view;
  if (v?.kind === 'server' && get().servers[v.serverId] && (!v.channelId || findChannel(v.channelId))) set({ view: v });
  else if (v?.kind === 'home' && (!v.dmId || get().dms[v.dmId])) set({ view: v });
  restored = true;
  useStore.subscribe((s, prev) => { if (s.view !== prev.view) write(); });
  useCall.subscribe((s, prev) => { if (s.channelId !== prev.channelId || s.muted !== prev.muted || s.deafened !== prev.deafened) write(); });
}

let rejoined = false;

/** Rejoins the call you were in before the reload. Call when the socket has the current voice states. */
export function resumeCall() {
  if (rejoined || !restored) return;
  rejoined = true;
  const call = read()?.call;
  if (!call || useCall.getState().channelId) return;
  const channel = findChannel(call.channelId);
  if (!channel) return;
  const me = get().me?.id;
  // A DM call with nobody left in it is over; rejoining would ring the others again.
  const others = Object.values(get().voiceStates).some((v) => v.channelId === call.channelId && v.userId !== me);
  if (channel.type !== 'voice' && !others) return;
  useCall.setState({ muted: call.muted, deafened: call.deafened });
  void joinCall(call.channelId);
}
