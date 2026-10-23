import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { uploadImage } from '../../lib/upload';
import type { Game, Widget } from '../../lib/types';
import { GameCover, WIDGET_INFO } from '../Mural';

const MAX_WIDGETS = 6;

/** Edits the list of mural widgets; changes go to the profile draft and are saved with it. */
export function WidgetEditor({ widgets, onChange, onError }: { widgets: Widget[]; onChange: (w: Widget[]) => void; onError: (msg: string) => void }) {
  const update = (i: number, w: Widget) => onChange(widgets.map((x, j) => (j === i ? w : x)));
  const remove = (i: number) => onChange(widgets.filter((_, j) => j !== i));
  const move = (i: number, d: number) => {
    const next = [...widgets];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const has = (t: Widget['type']) => widgets.some((w) => w.type === t);
  const full = widgets.length >= MAX_WIDGETS;

  return (
    <div className="widget-editor">
      {widgets.map((w, i) => (
        <div key={i} className="we-card">
          <div className="we-head">
            <strong>{WIDGET_INFO[w.type].title}</strong>
            <span className="we-tools">
              <button disabled={i === 0} onClick={() => move(i, -1)} title="Subir" aria-label="Subir widget"><ArrowUp size={14} /></button>
              <button disabled={i === widgets.length - 1} onClick={() => move(i, 1)} title="Descer" aria-label="Descer widget"><ArrowDown size={14} /></button>
              <button className="danger" onClick={() => remove(i)} title="Remover widget" aria-label={`Remover ${WIDGET_INFO[w.type].title}`}><Trash2 size={14} /></button>
            </span>
          </div>
          {w.type === 'favorite' && <FavoriteEditor w={w} onChange={(x) => update(i, x)} onError={onError} />}
          {w.type === 'games' && <GamesEditor w={w} onChange={(x) => update(i, x)} onError={onError} />}
          {w.type === 'text' && <>
            <label>Título<input value={w.title} maxLength={40} placeholder="ex.: Me chama pra jogar" onChange={(e) => update(i, { ...w, title: e.target.value })} /></label>
            <label>Texto<textarea value={w.text} maxLength={400} rows={3} onChange={(e) => update(i, { ...w, text: e.target.value })} /></label>
          </>}
        </div>
      ))}
      <div className="pe-row">
        {!has('favorite') && <button className="btn small" disabled={full} onClick={() => onChange([...widgets, { type: 'favorite', game: null, note: '' }])}><Plus size={14} /> Jogo favorito</button>}
        {!has('games') && <button className="btn small" disabled={full} onClick={() => onChange([...widgets, { type: 'games', games: [] }])}><Plus size={14} /> Jogos que eu gosto</button>}
        <button className="btn small" disabled={full} onClick={() => onChange([...widgets, { type: 'text', title: '', text: '' }])}><Plus size={14} /> Texto livre</button>
      </div>
    </div>
  );
}

/** Upload button for a game cover. */
function CoverButton({ onUploaded, onError, label = 'Capa' }: { onUploaded: (url: string) => void; onError: (msg: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <span className="btn small pe-file"><ImagePlus size={14} /> {busy ? 'Enviando…' : label}
      <input type="file" accept="image/*" aria-label={`Enviar ${label.toLowerCase()}`} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try { onUploaded(await uploadImage(f)); } catch (err) { onError((err as Error).message); } finally { setBusy(false); e.target.value = ''; }
      }} />
    </span>
  );
}

type SearchHit = { name: string; steamId?: number; catalogId?: string };
const toGame = (h: SearchHit): Game => ({ name: h.name, cover: null, ...(h.catalogId ? { catalogId: h.catalogId } : { steamId: h.steamId }) });

/** Type a name, pick the game from Steam's catalog (cover included) or add it by name only. */
function GameSearch({ onPick, disabled, placeholder = 'Buscar jogo (ex.: Rocket League)' }: { onPick: (g: Game) => void; disabled?: boolean; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      api<{ games: SearchHit[] }>(`/games/search?q=${encodeURIComponent(term)}`)
        .then((r) => { if (live) setResults(r.games); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const pick = (g: Game) => { onPick(g); setQ(''); setResults(null); };
  const term = q.trim();
  return (
    <div className="game-search">
      <div className="game-search-box">
        <Search size={15} />
        <input value={q} maxLength={60} placeholder={placeholder} disabled={disabled} aria-label="Buscar jogo"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.stopPropagation(); } if (e.key === 'Enter' && results?.[0]) pick(toGame(results[0])); }} />
      </div>
      {term.length >= 2 && (
        <div className="game-results" role="listbox">
          {loading && !results && <p className="muted small">Buscando…</p>}
          {results?.map((g) => (
            <button key={g.catalogId ?? g.steamId} role="option" onClick={() => pick(toGame(g))}>
              <GameCover game={toGame(g)} size="sm" /> <span>{g.name}</span>
            </button>
          ))}
          {results && results.length === 0 && !loading && <p className="muted small">Não achei esse jogo. Você pode adicionar só pelo nome e enviar uma capa.</p>}
          <button className="add-plain" onClick={() => pick({ name: term, cover: null })}><Plus size={14} /> Adicionar "{term}" sem capa</button>
        </div>
      )}
    </div>
  );
}

function FavoriteEditor({ w, onChange, onError }: { w: Extract<Widget, { type: 'favorite' }>; onChange: (w: Widget) => void; onError: (msg: string) => void }) {
  const game = w.game;
  return (
    <div className="we-favorite">
      {game && <GameCover game={game} />}
      <div className="we-fields">
        {game
          ? <div className="we-picked"><strong>{game.name}</strong><button className="btn small ghost" onClick={() => onChange({ ...w, game: null })}>Trocar jogo</button></div>
          : <GameSearch onPick={(g) => onChange({ ...w, game: g })} />}
        <label>Comentário<input value={w.note} maxLength={140} placeholder="ex.: sou Lenda Supersônica" onChange={(e) => onChange({ ...w, note: e.target.value })} /></label>
        {game && <div className="pe-row">
          <CoverButton label={game.cover ? 'Trocar capa' : 'Usar minha capa'} onUploaded={(cover) => onChange({ ...w, game: { ...game, cover } })} onError={onError} />
          {game.cover && <button className="btn small ghost" onClick={() => onChange({ ...w, game: { ...game, cover: null } })}>Remover minha capa</button>}
        </div>}
      </div>
    </div>
  );
}

function GamesEditor({ w, onChange, onError }: { w: Extract<Widget, { type: 'games' }>; onChange: (w: Widget) => void; onError: (msg: string) => void }) {
  const setGames = (games: Game[]) => onChange({ ...w, games });
  const full = w.games.length >= 20;
  return (
    <div>
      {w.games.map((g, i) => (
        <div key={i} className="we-game">
          <GameCover game={g} size="sm" />
          <span className="we-game-name">{g.name}</span>
          <CoverButton label={g.cover ? 'Trocar capa' : 'Minha capa'} onUploaded={(cover) => setGames(w.games.map((x, j) => (j === i ? { ...x, cover } : x)))} onError={onError} />
          <button className="icon-btn" title="Remover jogo" aria-label={`Remover ${g.name}`} onClick={() => setGames(w.games.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <div style={{ margin: '8px 0 12px' }}>
        <GameSearch disabled={full} placeholder={full ? 'Limite de 20 jogos' : 'Adicionar jogo (ex.: Minecraft)'} onPick={(g) => setGames([...w.games, g])} />
      </div>
    </div>
  );
}
