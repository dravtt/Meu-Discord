import { Gamepad2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { set, useStore } from '../lib/store';
import type { Activity, TopGame } from '../lib/types';
import { GameCover } from './Mural';
import { useGameDetect } from '../lib/gameDetect';

function elapsed(since: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** Turns minutes into "2 h 10 min", "45 min", etc. */
export function playTime(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}

/** Re-renders every minute so "há 5 min" keeps counting. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(t); }, []);
}

export const activityText = (a: Activity) => `Jogando ${a.name}`;

/** The "Jogando agora" card on a profile. */
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

/** The games this person played the most this week. Filled on its own from the desktop app. */
export function TopGames({ games }: { games: TopGame[] }) {
  if (!games.length) return null;
  const max = games[0].minutes || 1;
  return (
    <div className="top-games">
      <h4>Mais jogados da semana</h4>
      <div className="top-games-list">
        {games.map((g, i) => (
          <div key={i} className="top-game">
            <GameCover game={{ name: g.name, cover: null, steamId: g.steamId, catalogId: g.catalogId }} size="sm" />
            <div className="top-game-info">
              <strong>{g.name}</strong>
              <span className="top-game-bar"><i style={{ width: `${Math.max(8, (g.minutes / max) * 100)}%` }} /></span>
            </div>
            <time>{playTime(g.minutes)}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Updates (or clears) the game the desktop app detected. Called only by the detector. */
export async function setActivity(body: { name: string; steamId?: number; catalogId?: string; source: 'auto' } | null) {
  const me = useStore.getState().me;
  if (!me) return;
  const activity = body ? (await api<{ activity: Activity | null }>('/users/@me/activity', { method: 'PUT', body })).activity : null;
  if (!body) await api('/users/@me/activity', { method: 'DELETE' });
  set((s) => ({ me: s.me && { ...s.me, activity }, presence: { ...s.presence, [me.id]: { ...s.presence[me.id], activity } } }));
}

/** Profile tab: the game being played right now and the most played this week. */
export function ActivityTab({ activity, topGames, isMe }: { activity: Activity | null; topGames: TopGame[]; isMe: boolean }) {
  const detect = useGameDetect();
  const status = useStore((s) => (s.me ? s.presence[s.me.id]?.status ?? s.me.status : 'offline'));
  return (
    <div className="activity-tab">
      {activity
        ? <ActivityCard activity={activity} />
        : <div className="activity-card idle"><h4>Jogando agora</h4><p className="muted small">{isMe ? 'Nenhum jogo aberto agora.' : 'Não está jogando nada agora.'}</p></div>}
      {isMe && <DetectionNote available={detect.available} detected={detect.detected?.name ?? null} online={status === 'online'} />}
      {topGames.length
        ? <TopGames games={topGames} />
        : <div className="top-games"><h4>Mais jogados da semana</h4><p className="muted small">{isMe ? 'Os jogos que você jogar com o app do computador aberto aparecem aqui.' : 'Nenhum jogo nesta semana ainda.'}</p></div>}
    </div>
  );
}

/** Tells you why your game is (or is not) showing. Only you see it. */
function DetectionNote({ available, detected, online }: { available: boolean; detected: string | null; online: boolean }) {
  let text: string;
  if (!available) text = 'Você está no navegador, e o navegador não consegue ver os jogos abertos. Para o jogo aparecer, use o app do computador (npm.cmd run desktop).';
  else if (!online) text = 'O jogo só aparece quando você está Disponível.';
  else if (detected) text = `Detecção ligada: ${detected} encontrado.`;
  else text = 'Detecção ligada, mas nenhum jogo foi encontrado. Ela confere a cada 20 segundos e reconhece jogos da Steam, Epic e Riot. Se o seu jogo não aparecer, me diga o nome dele.';
  return <p className={`detect-note ${available && online ? '' : 'warn'}`}>{text}</p>;
}
