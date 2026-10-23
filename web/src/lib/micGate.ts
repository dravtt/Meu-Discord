import { Track, type AudioProcessorOptions, type TrackProcessor } from 'livekit-client';
import { useVoiceSettings } from './voiceSettings';
import { levelDb } from './speaking';

const HOLD_MS = 350;

/**
 * Sits between the microphone and the call. It lets sound through only while you talk (voice
 * detection with the chosen sensitivity) or while the push-to-talk key is held, and reports
 * the live level so the UI can light up your avatar.
 */
export class MicGate implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  name = 'nexo-mic-gate';
  processedTrack?: MediaStreamTrack;
  private cleanup: (() => void) | null = null;

  constructor(private readonly onChange: (state: { open: boolean; db: number; threshold: number }) => void) {}

  /** Push-to-talk key state, set from keyboard listeners. */
  static pttDown = false;
  static pttReleasedAt = 0;

  async init({ track, audioContext }: AudioProcessorOptions) {
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const gain = audioContext.createGain();
    gain.gain.value = 0;
    const dest = audioContext.createMediaStreamDestination();
    source.connect(analyser);
    source.connect(gain).connect(dest);
    this.processedTrack = dest.stream.getAudioTracks()[0];

    const buf = new Float32Array(analyser.fftSize);
    let lastLoud = 0;
    let noiseFloor = -70;
    let open = false;
    const id = setInterval(() => {
      const s = useVoiceSettings.getState();
      const db = levelDb(analyser, buf);
      const now = performance.now();
      // Background noise estimate: follows quiet moments fast, loud ones very slowly.
      noiseFloor = db < noiseFloor ? db * 0.3 + noiseFloor * 0.7 : noiseFloor + 0.02;
      const threshold = s.autoSensitivity ? Math.max(-65, Math.min(-30, noiseFloor + 12)) : s.sensitivityDb;
      let next: boolean;
      if (s.inputMode === 'ptt') next = MicGate.pttDown || now - MicGate.pttReleasedAt < s.pttReleaseMs;
      else {
        if (db > threshold) lastLoud = now;
        next = now - lastLoud < HOLD_MS;
      }
      if (next !== open) {
        open = next;
        gain.gain.setTargetAtTime(open ? 1 : 0, audioContext.currentTime, open ? 0.005 : 0.05);
      }
      this.onChange({ open, db, threshold });
    }, 20);
    this.cleanup = () => { clearInterval(id); source.disconnect(); gain.disconnect(); this.onChange({ open: false, db: -100, threshold: -100 }); };
  }

  async restart(opts: AudioProcessorOptions) {
    await this.destroy();
    await this.init(opts);
  }

  async destroy() {
    this.cleanup?.();
    this.cleanup = null;
  }
}

/** Global push-to-talk key listeners. Letter keys are ignored while typing in a text box. */
export function installPushToTalk() {
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && /^(Key|Digit|Space)/.test(e.code);
  };
  const down = (e: KeyboardEvent) => {
    const s = useVoiceSettings.getState();
    if (s.inputMode !== 'ptt' || e.code !== s.pttKey || typing(e)) return;
    MicGate.pttDown = true;
  };
  const up = (e: KeyboardEvent) => {
    if (e.code !== useVoiceSettings.getState().pttKey || !MicGate.pttDown) return;
    MicGate.pttDown = false;
    MicGate.pttReleasedAt = performance.now();
  };
  const blur = () => { if (MicGate.pttDown) { MicGate.pttDown = false; MicGate.pttReleasedAt = performance.now(); } };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
  };
}
