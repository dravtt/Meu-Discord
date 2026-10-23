import { create } from 'zustand';

/**
 * Who is talking right now, measured on this device from the actual audio (not the server's
 * active-speaker hints, which arrive late). Keys are user ids.
 */
export const useSpeaking = create<Record<string, boolean>>(() => ({}));

export function setSpeaking(userId: string, speaking: boolean) {
  if (!!useSpeaking.getState()[userId] !== speaking) useSpeaking.setState({ [userId]: speaking });
}

/** Level in dBFS of the samples currently in an analyser. */
export function levelDb(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-8);
}

const SPEAKING_DB = -50;
const HOLD_MS = 300;
let ctx: AudioContext | null = null;

/** Watches a remote person's audio and flags them as speaking within ~50 ms. */
export function watchRemoteAudio(userId: string, track: MediaStreamTrack) {
  ctx ??= new AudioContext();
  void ctx.resume();
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let lastLoud = 0;
  const id = setInterval(() => {
    const now = performance.now();
    if (levelDb(analyser, buf) > SPEAKING_DB) lastLoud = now;
    setSpeaking(userId, now - lastLoud < HOLD_MS);
  }, 50);
  return () => { clearInterval(id); source.disconnect(); setSpeaking(userId, false); };
}
