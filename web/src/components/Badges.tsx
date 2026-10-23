import { BadgeCheck, Castle, Crown, Gamepad2, Rocket, Users, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api';
import { set, useStore } from '../lib/store';
import type { User } from '../lib/types';
import { Dialog } from './Modal';

export const BADGES: Record<string, { label: string; how: string; icon: LucideIcon; color: string }> = {
  founder: { label: 'Fundador do Voka', how: 'A primeira conta criada no Voka.', icon: Crown, color: '#f5b83d' },
  pioneer: { label: 'Pioneiro', how: 'Criou a conta em 2026, no comecinho do Voka.', icon: Rocket, color: '#a06bff' },
  verified: { label: 'E-mail verificado', how: 'Confirmou o e-mail da conta.', icon: BadgeCheck, color: '#3ba7ff' },
  server_owner: { label: 'Dono de servidor', how: 'Criou ou é dono de um servidor.', icon: Castle, color: '#3fd28b' },
  popular: { label: 'Popular', how: 'Tem 10 amigos ou mais.', icon: Users, color: '#ff6fa8' },
  gamer: { label: 'Gamer', how: 'Colocou jogos no mural do perfil.', icon: Gamepad2, color: '#ff8a3d' },
};

/** The badges someone shows. For yourself that is the ones you earned minus the ones you hid. */
export function visibleBadges(user: User): string[] {
  const hidden = user.hiddenBadges ?? [];
  return (user.badges ?? []).filter((b) => BADGES[b] && !hidden.includes(b));
}

export function BadgeRow({ user }: { user: User }) {
  const list = visibleBadges(user);
  if (!list.length) return null;
  return (
    <div className="badge-row" aria-label="Insígnias">
      {list.map((id) => {
        const b = BADGES[id];
        const Icon = b.icon;
        return <span key={id} className="badge-icon" title={b.label} style={{ color: b.color }}><Icon size={16} strokeWidth={2.4} /></span>;
      })}
    </div>
  );
}

/** Choose which earned badges show on your profile. */
export function BadgesDialog() {
  const me = useStore((s) => s.me)!;
  const earned = me.badges ?? [];
  const [hidden, setHidden] = useState<string[]>(me.hiddenBadges ?? []);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: string) {
    const next = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
    setHidden(next);
    try {
      const r = await api<{ badges: string[]; hiddenBadges: string[] }>('/users/@me/badges', { method: 'PUT', body: { hidden: next } });
      set((s) => ({ me: s.me && { ...s.me, ...r } }));
    } catch (e) { setError((e as Error).message); setHidden(hidden); }
  }

  return (
    <Dialog title="Insígnias">
      <p className="muted small">As insígnias aparecem no seu perfil. Desligue as que você não quer mostrar.</p>
      <div className="badge-list">
        {Object.entries(BADGES).map(([id, b]) => {
          const Icon = b.icon;
          const has = earned.includes(id);
          return (
            <div key={id} className={`badge-item ${has ? '' : 'locked'}`}>
              <span className="badge-icon big" style={{ color: has ? b.color : undefined }}><Icon size={22} /></span>
              <span className="badge-text"><strong>{b.label}</strong><small>{has ? b.how : `Bloqueada: ${b.how}`}</small></span>
              {has && (
                <label className="switch" title={hidden.includes(id) ? 'Escondida' : 'Aparecendo'}>
                  <input type="checkbox" checked={!hidden.includes(id)} onChange={() => void toggle(id)} aria-label={`Mostrar ${b.label}`} />
                  <span />
                </label>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
