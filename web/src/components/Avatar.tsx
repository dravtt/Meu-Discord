import { useId } from 'react';
import { assetUrl } from '../lib/api';
import { useStore } from '../lib/store';
import type { User } from '../lib/types';

const PALETTE = ['#14b8a6', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#0ea5e9'];

export function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ user, size = 32, showStatus = false }: { user: Pick<User, 'id' | 'displayName' | 'avatarUrl'>; size?: number; showStatus?: boolean }) {
  const status = useStore((s) => s.presence[user.id]?.status ?? 'offline');
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {user.avatarUrl
        ? <img src={assetUrl(user.avatarUrl)} alt="" />
        : <span className="avatar-fallback" style={{ background: colorFor(user.id), fontSize: size * 0.42 }}>{user.displayName.slice(0, 1).toUpperCase()}</span>}
      {showStatus && <StatusIcon status={status} style={{ width: size * 0.28, height: size * 0.28, borderWidth: Math.max(2, Math.round(size * 0.07)) }} />}
    </span>
  );
}

export const STATUS_LABEL: Record<string, string> = { online: 'Disponível', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };

/**
 * The status symbol: a full dot (Disponível), a moon (Ausente), a dot with a bar (Não perturbe)
 * or a hollow ring (Invisível / offline). Shapes are cut with masks so they work on any background.
 */
export function StatusIcon({ status, inline, style }: { status: string; inline?: boolean; style?: React.CSSProperties }) {
  const id = useId();
  const shape = status === 'idle' ? 'idle' : status === 'dnd' ? 'dnd' : status === 'online' ? 'online' : 'offline';
  return (
    <span className={`status-dot ${status} ${inline ? 'inline' : ''}`} style={style} role="img" aria-label={STATUS_LABEL[status] ?? status}>
      <svg viewBox="0 0 20 20" width="100%" height="100%">
        {shape !== 'online' && (
          <mask id={id}>
            <rect width="20" height="20" fill="white" />
            {shape === 'idle' && <circle cx="5.5" cy="5.5" r="7.5" fill="black" />}
            {shape === 'dnd' && <rect x="4" y="8" width="12" height="4" rx="2" fill="black" />}
            {shape === 'offline' && <circle cx="10" cy="10" r="5" fill="black" />}
          </mask>
        )}
        <circle cx="10" cy="10" r="10" fill="currentColor" mask={shape === 'online' ? undefined : `url(#${id})`} />
      </svg>
    </span>
  );
}
