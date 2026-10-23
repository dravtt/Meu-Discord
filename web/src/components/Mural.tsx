import { assetUrl } from '../lib/api';
import type { Game, Widget } from '../lib/types';
import { colorFor } from './Avatar';

export const WIDGET_INFO: Record<Widget['type'], { title: string; hint: string }> = {
  favorite: { title: 'Jogo favorito', hint: 'Escolha 1 jogo' },
  games: { title: 'Jogos que eu gosto', hint: 'Até 20 jogos' },
  text: { title: 'Texto livre', hint: 'Um recado, links, o que quiser' },
};

/** A game's cover: the uploaded image, or a colored tile with its name. */
export function GameCover({ game, size = 'md' }: { game: Game; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`game-cover ${size}`} title={game.name}>
      {game.cover
        ? <img src={assetUrl(game.cover)} alt="" />
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
