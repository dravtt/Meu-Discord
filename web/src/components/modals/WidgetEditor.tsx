import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, X } from 'lucide-react';
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

function FavoriteEditor({ w, onChange, onError }: { w: Extract<Widget, { type: 'favorite' }>; onChange: (w: Widget) => void; onError: (msg: string) => void }) {
  const game: Game = w.game ?? { name: '', cover: null };
  const setGame = (g: Game) => onChange({ ...w, game: g.name.trim() || g.cover ? g : null });
  return (
    <div className="we-favorite">
      {game.name && <GameCover game={game} />}
      <div className="we-fields">
        <label>Nome do jogo<input value={game.name} maxLength={60} placeholder="ex.: Rocket League" onChange={(e) => setGame({ ...game, name: e.target.value })} /></label>
        <label>Comentário<input value={w.note} maxLength={140} placeholder="ex.: sou Lenda Supersônica" onChange={(e) => onChange({ ...w, note: e.target.value })} /></label>
        <div className="pe-row">
          <CoverButton label={game.cover ? 'Trocar capa' : 'Enviar capa'} onUploaded={(cover) => setGame({ ...game, cover })} onError={onError} />
          {game.cover && <button className="btn small ghost" onClick={() => setGame({ ...game, cover: null })}>Remover capa</button>}
        </div>
      </div>
    </div>
  );
}

function GamesEditor({ w, onChange, onError }: { w: Extract<Widget, { type: 'games' }>; onChange: (w: Widget) => void; onError: (msg: string) => void }) {
  const [name, setName] = useState('');
  const setGames = (games: Game[]) => onChange({ ...w, games });
  function add() {
    if (!name.trim() || w.games.length >= 20) return;
    setGames([...w.games, { name: name.trim(), cover: null }]);
    setName('');
  }
  return (
    <div>
      {w.games.map((g, i) => (
        <div key={i} className="we-game">
          <GameCover game={g} size="sm" />
          <span className="we-game-name">{g.name}</span>
          <CoverButton label={g.cover ? 'Trocar capa' : 'Capa'} onUploaded={(cover) => setGames(w.games.map((x, j) => (j === i ? { ...x, cover } : x)))} onError={onError} />
          <button className="icon-btn" title="Remover jogo" aria-label={`Remover ${g.name}`} onClick={() => setGames(w.games.filter((_, j) => j !== i))}><X size={16} /></button>
        </div>
      ))}
      <div className="pe-row" style={{ marginTop: 8 }}>
        <input className="we-add-input" value={name} maxLength={60} placeholder={w.games.length >= 20 ? 'Limite de 20 jogos' : 'Nome do jogo'} disabled={w.games.length >= 20}
          aria-label="Nome do jogo para adicionar" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn small" disabled={!name.trim() || w.games.length >= 20} onClick={add}><Plus size={14} /> Adicionar</button>
      </div>
    </div>
  );
}
