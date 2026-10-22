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
      {showStatus && <span className={`status-dot ${status}`} style={{ width: size * 0.36, height: size * 0.36 }} />}
    </span>
  );
}

export const STATUS_LABEL: Record<string, string> = { online: 'Disponível', idle: 'Ausente', dnd: 'Não perturbe', invisible: 'Invisível', offline: 'Offline' };
