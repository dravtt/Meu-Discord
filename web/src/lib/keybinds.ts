import { create } from 'zustand';
import { api } from './api';
import { get, set } from './store';
import { keyLabel } from './voiceSettings';
import { leaveCall, toggleDeafen, toggleMute, toggleVideo, useCall } from './voice';
import type { Status } from './types';

/**
 * Keyboard shortcuts. A shortcut is a key with optional modifiers, stored by physical key,
 * e.g. "Ctrl+Shift+KeyM" or just "F9". Each person sets their own on their device.
 */
export interface Action { id: string; label: string; group: string; fallback: string; run: () => void }

async function setStatus(status: Status) {
  const updated = await api('/users/@me', { method: 'PATCH', body: { status } });
  set((s) => ({ me: updated, presence: { ...s.presence, [updated.id]: { ...s.presence[updated.id], status, customStatus: updated.customStatus } } }));
}

function stepServer(dir: 1 | -1) {
  const s = get();
  const ids = ['home', ...s.serverOrder.filter((id) => s.servers[id])];
  const current = s.view.kind === 'server' ? s.view.serverId : 'home';
  const next = ids[(ids.indexOf(current) + dir + ids.length) % ids.length];
  set({ view: next === 'home' ? { kind: 'home' } : { kind: 'server', serverId: next }, openThreadId: null });
}

const clickVoiceButton = (title: string) => (document.querySelector(`.voice-bar-actions button[title="${title}"]`) as HTMLButtonElement | null)?.click();
const inCall = () => !!useCall.getState().channelId;

export const ACTIONS: Action[] = [
  { id: 'mute', label: 'Silenciar / ativar microfone', group: 'Chamada', fallback: 'Ctrl+Shift+KeyM', run: () => void toggleMute() },
  { id: 'deafen', label: 'Desativar / ativar áudio', group: 'Chamada', fallback: 'Ctrl+Shift+KeyD', run: () => void toggleDeafen() },
  { id: 'video', label: 'Ligar / desligar câmera', group: 'Chamada', fallback: '', run: () => { if (inCall()) void toggleVideo(); } },
  { id: 'screen', label: 'Compartilhar tela', group: 'Chamada', fallback: '', run: () => { if (inCall()) clickVoiceButton(useCall.getState().screen ? 'Parar de transmitir' : 'Compartilhar tela'); } },
  { id: 'soundboard', label: 'Abrir efeitos sonoros', group: 'Chamada', fallback: '', run: () => { if (inCall()) clickVoiceButton('Efeitos sonoros'); } },
  { id: 'leave', label: 'Sair da chamada', group: 'Chamada', fallback: 'Ctrl+Shift+KeyE', run: () => { if (inCall()) void leaveCall(); } },
  { id: 'home', label: 'Ir para Amigos e conversas', group: 'Navegação', fallback: 'Ctrl+Shift+KeyH', run: () => set({ view: { kind: 'home' }, openThreadId: null }) },
  { id: 'prev-server', label: 'Servidor anterior', group: 'Navegação', fallback: 'Ctrl+Alt+ArrowUp', run: () => stepServer(-1) },
  { id: 'next-server', label: 'Próximo servidor', group: 'Navegação', fallback: 'Ctrl+Alt+ArrowDown', run: () => stepServer(1) },
  { id: 'settings', label: 'Abrir configurações', group: 'Navegação', fallback: 'Ctrl+Comma', run: () => (document.querySelector('.user-panel [title="Configurações"]') as HTMLButtonElement | null)?.click() },
  { id: 'status-online', label: 'Ficar Disponível', group: 'Status', fallback: '', run: () => void setStatus('online') },
  { id: 'status-idle', label: 'Ficar Ausente', group: 'Status', fallback: '', run: () => void setStatus('idle') },
  { id: 'status-dnd', label: 'Ficar em Não perturbe', group: 'Status', fallback: '', run: () => void setStatus('dnd') },
  { id: 'status-invisible', label: 'Ficar Invisível', group: 'Status', fallback: '', run: () => void setStatus('invisible') },
];

const KEY = 'nexo:keybinds';
type Binds = Record<string, string>;

function load(): Binds {
  const defaults = Object.fromEntries(ACTIONS.map((a) => [a.id, a.fallback]));
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return defaults; }
}

export const useKeybinds = create<Binds>(load);
/** True while the settings screen is waiting for a new shortcut, so it does not also run. */
export const recording = { active: false };

export function saveKeybind(id: string, combo: string) {
  const next: Binds = { ...useKeybinds.getState(), [id]: combo };
  // One shortcut does one thing: taking it from another action clears it there.
  if (combo) for (const [other, c] of Object.entries(next)) if (other !== id && c === combo) next[other] = '';
  useKeybinds.setState(next, true);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export function resetKeybinds() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
  useKeybinds.setState(load(), true);
}

const MODIFIERS = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** "Ctrl+Shift+KeyM" for this key press, or null for a modifier on its own. */
export function comboOf(e: KeyboardEvent): string | null {
  if (MODIFIERS.has(e.code) || !e.code) return null;
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.code].filter(Boolean).join('+');
}

const PART_LABEL: Record<string, string> = { Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=', Escape: 'Esc', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down' };
export const comboLabel = (combo: string) => combo.split('+').map((p) => PART_LABEL[p] ?? (p.startsWith('Numpad') ? `Num ${p.slice(6)}` : keyLabel(p))).join(' + ');

/** Keys that type something; on their own they never fire a shortcut while you are typing. */
const typingKey = (code: string) => /^(Key|Digit|Space|Backquote|Minus|Equal|Bracket|Backslash|Semicolon|Quote|Comma|Period|Slash|Intl|Backspace|Delete|Enter|Arrow|Home|End|Tab|Numpad)/.test(code);

export function installKeybinds() {
  const onKey = (e: KeyboardEvent) => {
    if (recording.active || e.repeat) return;
    const combo = comboOf(e);
    if (!combo) return;
    const t = e.target as HTMLElement | null;
    const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    // While typing, a bare key or Shift+key is just text.
    if (inField && !e.ctrlKey && !e.altKey && !e.metaKey && typingKey(e.code)) return;
    const binds = useKeybinds.getState();
    const action = ACTIONS.find((a) => binds[a.id] === combo);
    if (!action) return;
    e.preventDefault();
    action.run();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
