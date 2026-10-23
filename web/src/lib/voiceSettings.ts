import { create } from 'zustand';

/** Microphone and processing choices, kept per device in localStorage. */
export interface VoiceSettings {
  inputDeviceId: string;
  outputDeviceId: string;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  /** Off by default: the browser's gain control pumps the volume up and down and amplifies background noise. */
  autoGainControl: boolean;
}

const KEY = 'nexo:voice';
const DEFAULTS: VoiceSettings = { inputDeviceId: 'default', outputDeviceId: 'default', echoCancellation: true, noiseSuppression: true, autoGainControl: false };

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
  };
}
