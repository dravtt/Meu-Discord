import { create } from 'zustand';

/** Per-device preferences kept in localStorage: look, notifications and per-person call volume. */
export type ThemeId = 'dark' | 'midnight' | 'light' | 'ocean' | 'grape' | 'forest';
export type ServerNotify = 'all' | 'mentions' | 'none';

export interface Prefs {
  theme: ThemeId;
  desktopNotifications: boolean;
  messageSounds: boolean;
  callSounds: boolean;
  /** Per server: notify on every message, only @mentions, or never. Missing means 'all'. */
  serverNotify: Record<string, ServerNotify>;
  /** Per user, 0–200 (%). Missing means 100. */
  userVolume: Record<string, number>;
  /** Users you muted for yourself in calls. */
  userMuted: Record<string, boolean>;
  /** Last screen share choices. */
  screenQuality: '720' | '1080' | 'source';
  screenFps: 15 | 30 | 60;
  screenAudio: boolean;
  /** Soundboard volume on this device, 0–100. */
  soundboardVolume: number;
  /** People whose soundboard sounds you do not want to hear. */
  userSoundMuted: Record<string, boolean>;
}

const KEY = 'nexo:prefs';
const DEFAULTS: Prefs = { theme: 'dark', desktopNotifications: true, messageSounds: true, callSounds: true, serverNotify: {}, userVolume: {}, userMuted: {}, screenQuality: '1080', screenFps: 30, screenAudio: true, soundboardVolume: 70, userSoundMuted: {} };

function load(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}

export const usePrefs = create<Prefs>(load);

export function savePrefs(patch: Partial<Prefs> | ((p: Prefs) => Partial<Prefs>)) {
  usePrefs.setState(patch);
  try { localStorage.setItem(KEY, JSON.stringify(usePrefs.getState())); } catch { /* private mode */ }
}

export const THEMES: { id: ThemeId; name: string; swatch: [string, string, string] }[] = [
  { id: 'dark', name: 'Escuro', swatch: ['#1a1b1f', '#2f3036', '#14b8a6'] },
  { id: 'midnight', name: 'Meia-noite', swatch: ['#000000', '#0b0b0d', '#14b8a6'] },
  { id: 'light', name: 'Claro', swatch: ['#e3e5e8', '#ffffff', '#0d9488'] },
  { id: 'ocean', name: 'Oceano', swatch: ['#0b1626', '#15253b', '#38bdf8'] },
  { id: 'grape', name: 'Uva', swatch: ['#1a1325', '#2a1f3d', '#a78bfa'] },
  { id: 'forest', name: 'Floresta', swatch: ['#0f1a14', '#1a2b21', '#4ade80'] },
];

export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
}
