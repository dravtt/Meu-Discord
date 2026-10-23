import { Gamepad2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { set, useStore } from '../lib/store';
import type { Activity } from '../lib/types';
import { closeModal, Dialog } from './Modal';
import { GameCover } from './Mural';
import { GameSearch } from './modals/WidgetEditor';

function elapsed(since: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Re-renders every minute so "há 5 min" keeps counting. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
}

export const activityText = (a: Activity) => `Jogando ${a.name}`;

/** The "Jogando …" card on a profile. */
export function ActivityCard({ activity }: { activity: Activity }) {
  useMinuteTick();
  return (
    <div className="activity-card">
      <h4>Jogando agora</h4>
      <div className="activity-body">
        <GameCover game={{ name: activity.name, cover: null, steamId: activity.steamId, catalogId: activity.catalogId }} size="sm" />
        <div><strong>{activity.name}</strong><small>{elapsed(activity.since)}</small></div>
      </div>
    </div>
  );
}

/** One short line for lists: icon + "Jogando X". */
export function ActivityLine({ activity }: { activity: Activity }) {
  return <small className="activity-line"><Gamepad2 size={12} /> Jogando <strong>{activity.name}</strong></small>;
}

export async function setActivity(body: { name: string; steamId?: number; catalogId?: string; source: 'manual' | 'auto' } | null) {
  const me = useStore.getState().me;
  if (!me) return;
  const activity = body ? (await api<{ activity: Activity }>('/users/@me/activity', { method: 'PUT', body })).activity : null;
  if (!body) await api('/users/@me/activity', { method: 'DELETE' });
  set((s) => ({ me: s.me && { ...s.me, activity }, presence: { ...s.presence, [me.id]: { ...s.presence[me.id], activity } } }));
}

/** Pick the game you are playing by hand (the desktop app also detects it on its own). */
export function ActivityDialog() {
  const current = useStore((s) => (s.me ? s.presence[s.me.id]?.activity : null));
  const [error, setError] = useState<string | null>(null);
  const desktop = !!(window as any).nexoNative;
  return (
    <Dialog title="O que você está jogando?">
      <p className="muted small">
        Seus amigos veem "Jogando…" no seu perfil e na lista de membros. Some sozinho quando você fica offline.
        {desktop ? ' O app do computador também detecta os jogos abertos sozinho.' : ' No app do computador isso é detectado sozinho.'}
      </p>
      {current && (
        <div className="pe-row" style={{ marginBottom: 12 }}>
          <ActivityCard activity={current} />
          <button className="btn small ghost" onClick={() => void setActivity(null).then(closeModal).catch((e) => setError(e.message))}>Parar de mostrar</button>
        </div>
      )}
      <GameSearch placeholder="Buscar jogo (ex.: VALORANT)" onPick={(g) => {
        void setActivity({ name: g.name, steamId: g.steamId, catalogId: g.catalogId, source: 'manual' }).then(closeModal).catch((e) => setError(e.message));
      }} />
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
