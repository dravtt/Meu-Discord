import { create } from 'zustand';
import { api, assetUrl } from './api';
import { usePrefs } from './prefs';
import { useCall } from './voice';

/** A sound someone uploaded to a server. */
export interface Sound { id: string; serverId: string; name: string; emoji: string; url: string; volume: number; uploaderId: string | null }

export interface SoundPlay { channelId: string; userId: string; soundId?: string; builtin?: string; url?: string; volume?: number; name?: string; emoji?: string }

/* ---------- built-in sounds, synthesized so the app ships no audio files ---------- */

type Synth = (c: AudioContext, out: AudioNode, t: number) => number;

function osc(c: AudioContext, out: AudioNode, type: OscillatorType, freq: number, t: number, len: number, vol: number, attack = 0.01) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.setValueAtTime(vol, t + Math.max(attack, len - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.05);
  return o;
}

let noiseBuffer: AudioBuffer | null = null;
function noise(c: AudioContext, out: AudioNode, t: number, len: number, vol: number, filter: BiquadFilterType, freq: number, q = 1) {
  if (!noiseBuffer || noiseBuffer.sampleRate !== c.sampleRate) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + len + 0.05);
}

function drum(c: AudioContext, out: AudioNode, t: number, from: number, to: number, len: number, vol: number) {
  const o = osc(c, out, 'sine', from, t, len, vol, 0.002);
  o.frequency.exponentialRampToValueAtTime(to, t + len * 0.8);
}

const SYNTHS: Record<string, Synth> = {
  // Party horn: a detuned brass chord in three blasts.
  buzina(c, out, t) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    lp.connect(out);
    const blasts: [number, number][] = [[0, 0.32], [0.38, 0.14], [0.58, 0.9]];
    for (const [at, len] of blasts) for (const f of [415, 419, 523, 831]) osc(c, lp, 'sawtooth', f, t + at, len, 0.06, 0.02);
    return 1.6;
  },
  // Joke drum: two toms and a cymbal.
  tambor(c, out, t) {
    drum(c, out, t, 220, 90, 0.25, 0.7);
    drum(c, out, t + 0.2, 160, 65, 0.3, 0.7);
    drum(c, out, t + 0.45, 120, 50, 0.3, 0.6);
    noise(c, out, t + 0.45, 1.2, 0.35, 'highpass', 6500);
    return 1.8;
  },
  palmas(c, out, t) {
    for (let i = 0; i < 26; i++) {
      const at = t + Math.random() * 1.8;
      noise(c, out, at, 0.06 + Math.random() * 0.05, 0.25 + Math.random() * 0.3, 'bandpass', 1100 + Math.random() * 1400, 1.2);
    }
    return 2.1;
  },
  grilos(c, out, t) {
    for (let round = 0; round < 5; round++) {
      for (const [base, delay] of [[4400, 0], [4100, 0.21]] as const) {
        for (let p = 0; p < 3; p++) osc(c, out, 'sine', base, t + round * 0.45 + delay + p * 0.045, 0.03, 0.12, 0.004);
      }
    }
    return 2.4;
  },
  // Sad trombone: four falling notes, the last one wobbling.
  trombone(c, out, t) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(out);
    const seq: [number, number, number][] = [[294, 0, 0.42], [277, 0.45, 0.42], [262, 0.9, 0.42], [247, 1.35, 1.2]];
    for (const [f, at, len] of seq) {
      const o = osc(c, lp, 'sawtooth', f, t + at, len, 0.2, 0.03);
      if (len > 1) {
        const lfo = c.createOscillator();
        const depth = c.createGain();
        lfo.frequency.value = 6;
        depth.gain.value = 7;
        lfo.connect(depth).connect(o.frequency);
        lfo.start(t + at + 0.15);
        lfo.stop(t + at + len);
      }
    }
    return 2.7;
  },
  pato(c, out, t) {
    for (const at of [0, 0.32]) {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 4;
      bp.connect(out);
      const o = osc(c, bp, 'sawtooth', 300, t + at, 0.24, 0.9, 0.01);
      o.frequency.exponentialRampToValueAtTime(190, t + at + 0.22);
    }
    return 0.7;
  },
  tada(c, out, t) {
    osc(c, out, 'triangle', 523, t, 0.12, 0.25);
    osc(c, out, 'triangle', 659, t + 0.1, 0.12, 0.25);
    for (const f of [523, 659, 784, 1047]) osc(c, out, 'triangle', f, t + 0.22, 1.1, 0.16);
    for (const f of [523, 784]) osc(c, out, 'sawtooth', f / 2, t + 0.22, 1.1, 0.05);
    return 1.4;
  },
  boing(c, out, t) {
    const o = osc(c, out, 'sine', 140, t, 0.75, 0.45, 0.005);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.08);
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 14;
    depth.gain.setValueAtTime(160, t);
    depth.gain.exponentialRampToValueAtTime(5, t + 0.7);
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.8);
    return 0.9;
  },
  // Dramatic "dun dun duuun".
  suspense(c, out, t) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(out);
    const seq: [number, number, number][] = [[147, 0, 0.3], [147, 0.4, 0.3], [139, 0.8, 1.6]];
    for (const [f, at, len] of seq) {
      for (const m of [1, 1.5, 2.005]) osc(c, lp, 'sawtooth', f * m, t + at, len, 0.08, 0.02);
      drum(c, out, t + at, 90, 45, 0.4, 0.5);
    }
    return 2.5;
  },
  sino(c, out, t) {
    for (const [m, v] of [[1, 0.3], [2.0, 0.15], [3.01, 0.1], [4.2, 0.07], [5.4, 0.04]] as const) osc(c, out, 'sine', 880 * m, t, 2.2 / m + 0.4, v, 0.003);
    return 2.6;
  },
};

export const BUILTIN_SOUNDS: { id: string; name: string; emoji: string }[] = [
  { id: 'buzina', name: 'buzina', emoji: '📯' },
  { id: 'tambor', name: 'ba dum tss', emoji: '🥁' },
  { id: 'palmas', name: 'palmas', emoji: '👏' },
  { id: 'grilos', name: 'grilos', emoji: '🦗' },
  { id: 'trombone', name: 'trombone triste', emoji: '🎺' },
  { id: 'pato', name: 'quack', emoji: '🦆' },
  { id: 'tada', name: 'tadá', emoji: '🎉' },
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

/** Plays a sound on this device only (used for previews and for sounds others trigger). */
export async function playLocal(s: { builtin?: string; url?: string; volume?: number }) {
  if (s.builtin && SYNTHS[s.builtin]) {
    const out = output(1);
    const len = SYNTHS[s.builtin](ctx!, out, ctx!.currentTime + 0.02);
    setTimeout(() => out.disconnect(), (len + 0.5) * 1000);
    return;
  }
  if (!s.url) return;
  const buf = await loadBuffer(s.url).catch(() => null);
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
