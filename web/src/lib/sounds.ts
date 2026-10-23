/** Call sounds synthesized with Web Audio, so the app ships no audio files. */
let ctx: AudioContext | null = null;
const audio = () => (ctx ??= new AudioContext());

function tone(freq: number, start: number, length: number, volume: number) {
  const c = audio();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

function loop(play: (t: number) => void, everyMs: number) {
  const c = audio();
  void c.resume();
  play(c.currentTime + 0.05);
  const id = setInterval(() => play(audio().currentTime + 0.05), everyMs);
  return () => clearInterval(id);
}

/** Someone is calling you: a rising three-note chime. */
export const startRingtone = () => loop((t) => {
  tone(659, t, 0.35, 0.18);
  tone(784, t + 0.18, 0.35, 0.18);
  tone(988, t + 0.36, 0.6, 0.18);
}, 2200);

/** You are calling someone: a soft double beep while it rings on their side. */
export const startRingback = () => loop((t) => {
  tone(440, t, 0.4, 0.08);
  tone(440, t + 0.5, 0.4, 0.08);
}, 3000);

export function playHangup() {
  const t = audio().currentTime + 0.02;
  tone(523, t, 0.25, 0.12);
  tone(392, t + 0.18, 0.35, 0.12);
}
