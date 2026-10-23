import { usePrefs } from './prefs';

/** App sounds synthesized with Web Audio, so the app ships no audio files. */
let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

function tone(freq: number, start: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const c = audio();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Plays a short sequence of [frequency, offset seconds, length seconds] notes. */
function notes(seq: [number, number, number][], volume = 0.12) {
  const c = audio();
  void c.resume();
  const t = c.currentTime + 0.02;
  for (const [f, at, len] of seq) tone(f, t + at, len, volume);
}

function loop(play: () => void, everyMs: number) {
  play();
  const id = setInterval(play, everyMs);
  return () => clearInterval(id);
}

const callSounds = () => usePrefs.getState().callSounds;

/** Someone is calling you: a rising three-note chime. */
export const startRingtone = () => loop(() => notes([[659, 0, 0.35], [784, 0.18, 0.35], [988, 0.36, 0.6]], 0.18), 2200);

/** You are calling someone: a soft double beep while it rings on their side. */
export const startRingback = () => loop(() => notes([[440, 0, 0.4], [440, 0.5, 0.4]], 0.08), 3000);

export function playHangup() { if (callSounds()) notes([[523, 0, 0.25], [392, 0.18, 0.35]]); }
export function playJoin() { if (callSounds()) notes([[523, 0, 0.18], [784, 0.12, 0.3]]); }
export function playLeave() { if (callSounds()) notes([[784, 0, 0.18], [523, 0.12, 0.3]]); }
export function playMute() { if (callSounds()) notes([[620, 0, 0.09], [440, 0.07, 0.12]], 0.1); }
export function playUnmute() { if (callSounds()) notes([[440, 0, 0.09], [620, 0.07, 0.12]], 0.1); }
export function playDeafen() { if (callSounds()) notes([[520, 0, 0.1], [390, 0.08, 0.1], [290, 0.16, 0.16]], 0.1); }
export function playUndeafen() { if (callSounds()) notes([[290, 0, 0.1], [390, 0.08, 0.1], [520, 0.16, 0.16]], 0.1); }
export function playStreamStart() { if (callSounds()) notes([[660, 0, 0.12], [880, 0.1, 0.12], [1100, 0.2, 0.2]], 0.08); }

/** New message ping, throttled so a burst of messages makes one sound. */
let lastPing = 0;
export function playMessage() {
  if (!usePrefs.getState().messageSounds) return;
  const now = Date.now();
  if (now - lastPing < 800) return;
  lastPing = now;
  notes([[880, 0, 0.12], [1320, 0.08, 0.25]], 0.09);
}
