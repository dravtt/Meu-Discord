import { create } from 'zustand';

/** Microphone and processing choices, kept per device in localStorage. */
export interface VoiceSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  /** Off by default: the browser's gain control pumps the volume up and down and amplifies background noise. */
  autoGainControl: boolean;
  /** Open mic with voice detection, or push to talk. */
  inputMode: 'voice' | 'ptt';
  /** KeyboardEvent.code of the push-to-talk key. */
  pttKey: string;
  /** Keeps the mic open briefly after the key is released so the last word is not cut. */
  pttReleaseMs: number;
  /** Let Nexo pick the sensitivity from the background noise level. */
  autoSensitivity: boolean;
  /** Manual voice-detection threshold in dB (-100 = everything passes, 0 = nothing passes). */
  sensitivityDb: number;
}

const KEY = 'nexo:voice';
const DEFAULTS: VoiceSettings = {
  inputDeviceId: 'default', outputDeviceId: 'default',
  echoCancellation: true, noiseSuppression: true, autoGainControl: false,
  inputMode: 'voice', pttKey: 'KeyV', pttReleaseMs: 200,
  autoSensitivity: true, sensitivityDb: -55,
};

function load(): VoiceSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}

export const useVoiceSettings = create<VoiceSettings>(load);

export function saveVoiceSettings(patch: Partial<VoiceSettings>) {
  useVoiceSettings.setState(patch);
  try { localStorage.setItem(KEY, JSON.stringify(useVoiceSettings.getState())); } catch { /* private mode */ }
}

export function audioConstraints(s: VoiceSettings = useVoiceSettings.getState()) {
  return {
    deviceId: s.inputDeviceId === 'default' ? undefined : s.inputDeviceId,
    echoCancellation: s.echoCancellation,
    noiseSuppression: s.noiseSuppression,
    autoGainControl: s.autoGainControl,
    channelCount: 1,
    sampleRate: 48000,
    sampleSize: 16,
  };
}

/** Human name for a KeyboardEvent.code, e.g. "KeyV" -> "V". */
export function keyLabel(code: string) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const names: Record<string, string> = { Space: 'Espaço', Backquote: "'", CapsLock: 'Caps Lock', ShiftLeft: 'Shift esquerdo', ShiftRight: 'Shift direito', ControlLeft: 'Ctrl esquerdo', ControlRight: 'Ctrl direito', AltLeft: 'Alt', AltRight: 'Alt Gr', Tab: 'Tab' };
  return names[code] ?? code;
}
