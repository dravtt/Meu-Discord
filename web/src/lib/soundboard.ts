import { create } from 'zustand';
import { api, assetUrl } from './api';
import { usePrefs } from './prefs';
import { useCall } from './voice';

/** A sound someone uploaded to a server. */
export interface Sound { id: string; serverId: string; name: string; emoji: string; url: string; volume: number; uploaderId: string | null }

export interface SoundPlay { channelId: string; userId: string; soundId?: string; builtin?: string; url?: string; volume?: number; name?: string; emoji?: string }

/* ---------- built-in sounds: recordings from Pixabay in web/public/sounds (see CREDITS.txt) ---------- */

export const BUILTIN_SOUNDS: { id: string; name: string; emoji: string }[] = [
  { id: 'buzina', name: 'buzina', emoji: '📯' },
  { id: 'tambor', name: 'ba dum tss', emoji: '🥁' },
  { id: 'palmas', name: 'palmas', emoji: '👏' },
  { id: 'grilos', name: 'grilos', emoji: '🦗' },
  { id: 'trombone', name: 'trombone triste', emoji: '🎺' },
  { id: 'pato', name: 'quack', emoji: '🦆' },
  { id: 'tada', name: 'tadaaa', emoji: '🎉' },
  { id: 'boing', name: 'boing', emoji: '🪀' },
  { id: 'suspense', name: 'suspense', emoji: '😱' },
  { id: 'sino', name: 'sino', emoji: '🔔' },
];

/* ---------- playback ---------- */

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();
let playing: { stop: () => void }[] = [];

function output(volume: number) {
  ctx ??= new AudioContext();
  void ctx.resume();
  const g = ctx.createGain();
  g.gain.value = Math.max(0, Math.min(1, volume)) * (usePrefs.getState().soundboardVolume / 100);
  g.connect(ctx.destination);
  return g;
}

function loadBuffer(url: string) {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(assetUrl(url)).then((r) => r.arrayBuffer()).then((b) => (ctx ??= new AudioContext()).decodeAudioData(b));
    p.catch(() => buffers.delete(url));
    buffers.set(url, p);
  }
  return p;
}

/** Fetches the built-in sounds ahead of time so the first play has no delay. */
export function preloadBuiltins() {
  for (const b of BUILTIN_SOUNDS) void loadBuffer(`/sounds/${b.id}.mp3`).catch(() => {});
}

/** Plays a sound on this device only (used for previews and for sounds others trigger). */
export async function playLocal(s: { builtin?: string; url?: string; volume?: number }) {
  const url = s.builtin ? (BUILTIN_SOUNDS.some((b) => b.id === s.builtin) ? `/sounds/${s.builtin}.mp3` : null) : s.url;
  if (!url) return;
  const buf = await loadBuffer(url).catch(() => null);
  if (!buf) return;
  const out = output(s.volume ?? 1);
  const src = ctx!.createBufferSource();
  src.buffer = buf;
  src.connect(out);
  // Long uploads are cut so nobody can hold the call hostage.
  src.start(0, 0, Math.min(buf.duration, 6));
  const entry = { stop: () => { try { src.stop(); } catch { /* already done */ } } };
  playing.push(entry);
  src.onended = () => { out.disconnect(); playing = playing.filter((p) => p !== entry); };
}

/** Stops every sound playing right now (e.g. when you deafen or leave). */
export function stopAllSounds() {
  for (const p of playing) p.stop();
  playing = [];
}

/** Asks the server to play a sound for everyone in your call. */
export async function playForCall(s: { soundId?: string; builtin?: string }) {
  await api('/voice/soundboard', { body: s });
}

/** Who just played what, so call tiles can show the emoji for a moment. */
export const useSoundBubbles = create<Record<string, { emoji: string; name: string; at: number }>>(() => ({}));

/** Socket handler: someone in a call played a sound. */
export function onSoundPlayed(p: SoundPlay) {
  const call = useCall.getState();
  if (call.channelId !== p.channelId) return;
  const meta = p.builtin ? BUILTIN_SOUNDS.find((b) => b.id === p.builtin) : { emoji: p.emoji || '🔊', name: p.name ?? '' };
  const at = Date.now();
  useSoundBubbles.setState({ [p.userId]: { emoji: meta?.emoji || '🔊', name: meta?.name ?? '', at } });
  setTimeout(() => { if (useSoundBubbles.getState()[p.userId]?.at === at) useSoundBubbles.setState({ [p.userId]: undefined as never }); }, 2500);
  if (call.deafened || usePrefs.getState().userSoundMuted[p.userId]) return;
  void playLocal(p);
}

/* ---------- server sound lists ---------- */

export const useServerSounds = create<Record<string, { sounds: Sound[]; canManage: boolean }>>(() => ({}));

export async function loadServerSounds(serverId: string) {
  try {
    const data = await api<{ sounds: Sound[]; canManage: boolean }>(`/servers/${serverId}/sounds`);
    useServerSounds.setState({ [serverId]: data });
  } catch { /* not a member any more */ }
}
