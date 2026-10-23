import { useState } from 'react';
import { assetUrl } from '../lib/api';
import type { Game, Widget } from '../lib/types';
import { colorFor } from './Avatar';

export const WIDGET_INFO: Record<Widget['type'], { title: string; hint: string }> = {
  favorite: { title: 'Jogo favorito', hint: 'Escolha 1 jogo' },
  games: { title: 'Jogos que eu gosto', hint: 'Até 20 jogos' },
  text: { title: 'Texto livre', hint: 'Um recado, links, o que quiser' },
};

const STEAM_ART = (id: number) => [
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
  `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
];

/** A game's cover: the uploaded image, Steam's art (trying each size in turn), or a colored tile with its name. */
export function GameCover({ game, size = 'md' }: { game: Game; size?: 'sm' | 'md' | 'lg' }) {
  const sources = game.cover ? [assetUrl(game.cover)] : game.steamId ? STEAM_ART(game.steamId) : [];
  const key = sources.join();
  const [failed, setFailed] = useState({ key, count: 0 });
  const tries = failed.key === key ? failed.count : 0;
  const src = sources[tries];
  return (
    <span className={`game-cover ${size}`} title={game.name}>
      {src
        ? <img key={src} src={src} alt="" loading="lazy" onError={() => setFailed({ key, count: tries + 1 })} />
        : <span className="game-cover-fallback" style={{ background: `linear-gradient(160deg, ${colorFor(game.name)}, #111)` }}>{game.name}</span>}
    </span>
  );
}

/** The widgets someone put on their profile. */
export function Mural({ widgets }: { widgets: Widget[] }) {
  return (
    <div className="mural">
      {widgets.map((w, i) => (
        <section key={i} className={`widget widget-${w.type}`}>
          <header><strong>{w.type === 'text' && w.title ? w.title : WIDGET_INFO[w.type].title}</strong></header>
          {w.type === 'favorite' && (w.game
            ? <div className="widget-favorite-body"><GameCover game={w.game} size="lg" /><div><strong>{w.game.name}</strong>{w.note && <p>{w.note}</p>}</div></div>
            : <p className="muted small">Nenhum jogo escolhido.</p>)}
          {w.type === 'games' && (w.games.length
            ? <div className="games-row">{w.games.map((g, j) => <figure key={j}><GameCover game={g} /><figcaption>{g.name}</figcaption></figure>)}</div>
            : <p className="muted small">Nenhum jogo ainda.</p>)}
          {w.type === 'text' && <p className="widget-text">{w.text}</p>}
        </section>
      ))}
    </div>
  );
}
