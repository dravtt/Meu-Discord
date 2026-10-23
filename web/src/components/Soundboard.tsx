import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Play, Plus, Search, Trash2, Volume1, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api';
import { findChannel, useStore } from '../lib/store';
import { savePrefs, usePrefs } from '../lib/prefs';
import { useCall } from '../lib/voice';
import { BUILTIN_SOUNDS, loadServerSounds, preloadBuiltins, playForCall, playLocal, useServerSounds, type Sound } from '../lib/soundboard';
import { useClickOutside } from './ContextMenu';
import { closeModal, confirmDialog, Dialog, openModal } from './Modal';

const usePanel = create<{ x: number; bottom: number } | null>(() => null);

/** Opens the soundboard above the button that was clicked (or closes it if open). */
let closedAt = 0;
export function toggleSoundboard(e: React.MouseEvent) {
  e.stopPropagation();
  if (usePanel.getState()) return usePanel.setState(null, true);
  // The mousedown that closed the panel (click outside) is the same click on this button.
  if (Date.now() - closedAt < 300) return;
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  usePanel.setState({ x: r.left + r.width / 2, bottom: innerHeight - r.top + 8 }, true);
}

export const useSoundboardOpen = () => usePanel((s) => !!s);

export function SoundboardHost() {
  const pos = usePanel();
  const inCall = useCall((s) => !!s.channelId);
  useEffect(() => { if (!inCall) usePanel.setState(null, true); else preloadBuiltins(); }, [inCall]);
  if (!pos || !inCall) return null;
  return <SoundboardPanel x={pos.x} bottom={pos.bottom} />;
}

function SoundboardPanel({ x, bottom }: { x: number; bottom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const callChannel = useCall((s) => s.channelId);
  const servers = useStore(useShallow((s) => s.serverOrder.map((id) => s.servers[id]).filter(Boolean)));
  const lists = useServerSounds();
  const volume = usePrefs((p) => p.soundboardVolume);
  const close = useRef(() => { closedAt = Date.now(); usePanel.setState(null, true); }).current;
  useClickOutside(ref, true, close);

  // The server of the current call comes first.
  const callServer = findChannel(callChannel ?? undefined)?.serverId ?? null;
  const ordered = useMemo(() => [...servers].sort((a, b) => (a.id === callServer ? -1 : b.id === callServer ? 1 : 0)), [servers, callServer]);
  useEffect(() => { for (const s of servers) void loadServerSounds(s.id); }, [servers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const match = (name: string) => !q || name.toLowerCase().includes(q);

  async function play(s: { soundId?: string; builtin?: string }) {
    setError(null);
    try { await playForCall(s); } catch (e) { setError((e as Error).message); }
  }

  const width = Math.min(560, innerWidth - 16);
  const left = Math.max(8, Math.min(x - width / 2, innerWidth - width - 8));

  return (
    <div ref={ref} className="soundboard" style={{ left, bottom, width }} role="dialog" aria-label="Efeitos sonoros">
      <div className="soundboard-top">
        <div className="soundboard-search">
          <Search size={16} />
          <input autoFocus placeholder="Buscar som" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="soundboard-volume" title={`Volume dos efeitos: ${volume}%`}>
          {volume === 0 ? <VolumeX size={18} /> : volume < 50 ? <Volume1 size={18} /> : <Volume2 size={18} />}
          <input type="range" min={0} max={100} step={5} value={volume} aria-label="Volume dos efeitos sonoros" onChange={(e) => savePrefs({ soundboardVolume: Number(e.target.value) })} />
        </div>
      </div>
      {error && <p className="error soundboard-error">{error}</p>}
      <div className="soundboard-body">
        {ordered.map((srv) => {
          const data = lists[srv.id];
          const sounds = (data?.sounds ?? []).filter((s) => match(s.name));
          if (q && sounds.length === 0) return null;
          return (
            <section key={srv.id}>
              <h4>{srv.name}</h4>
              <div className="sound-grid">
                {sounds.map((s) => <SoundTile key={s.id} emoji={s.emoji} name={s.name} onPlay={() => play({ soundId: s.id })} onPreview={() => playLocal(s)}
                  onDelete={canDelete(s, data!.canManage) ? () => { close(); confirmDialog('Apagar som', `Apagar o som "${s.name}"?`, 'Apagar', async () => { await api(`/servers/${srv.id}/sounds/${s.id}`, { method: 'DELETE' }); }); } : undefined} />)}
                {!q && <button className="sound-tile add" onClick={() => { close(); openModal(<AddSoundModal serverId={srv.id} serverName={srv.name} />); }}><Plus size={16} /> Adicionar som</button>}
              </div>
            </section>
          );
        })}
        <section>
          <h4>Sons do Voka</h4>
          <div className="sound-grid">
            {BUILTIN_SOUNDS.filter((b) => match(b.name)).map((b) => (
              <SoundTile key={b.id} emoji={b.emoji} name={b.name} onPlay={() => play({ builtin: b.id })} onPreview={() => playLocal({ builtin: b.id })} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function canDelete(s: Sound, canManage: boolean) {
  const me = useStore.getState().me?.id;
  return canManage || s.uploaderId === me;
}

function SoundTile({ emoji, name, onPlay, onPreview, onDelete }: { emoji: string; name: string; onPlay: () => void; onPreview: () => void; onDelete?: () => void }) {
  return (
    <div className="sound-tile">
      <button className="sound-play" onClick={onPlay} title={`Tocar "${name}" para todos na chamada`}>
        <span className="sound-emoji">{emoji || '🔊'}</span>
        <span className="sound-name">{name}</span>
      </button>
      <span className="sound-tools">
        <button title="Ouvir só para mim" aria-label={`Ouvir ${name} só para mim`} onClick={onPreview}><Play size={13} /></button>
        {onDelete && <button title="Apagar som" aria-label={`Apagar ${name}`} className="danger" onClick={onDelete}><Trash2 size={13} /></button>}
      </span>
    </div>
  );
}

const EMOJI_CHOICES = ['😂', '🔥', '💀', '👏', '🎉', '😱', '🤡', '🐐', '💥', '🎵', '📢', '🤣'];

function AddSoundModal({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [volume, setVolume] = useState(100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  function pick(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > 1024 * 1024) { setError('O arquivo precisa ter no máximo 1 MB (uns 5 segundos de MP3).'); return; }
    setFile(f);
    if (!name) setName(f.name.replace(/\.[^.]+$/, '').slice(0, 32));
  }

  function preview() {
    if (!previewUrl) return;
    const a = new Audio(previewUrl);
    a.volume = volume / 100;
    void a.play();
    setTimeout(() => a.pause(), 6000);
  }

  async function save() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('name', name.trim());
    form.append('emoji', emoji);
    form.append('volume', String(volume / 100));
    form.append('file', file);
    try {
      await api(`/servers/${serverId}/sounds`, { form });
      await loadServerSounds(serverId);
      closeModal();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog title={`Adicionar som em ${serverName}`} footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn primary" disabled={!file || !name.trim() || busy} onClick={save}>{busy ? 'Enviando…' : 'Enviar'}</button>
    </>}>
      <p className="muted small">MP3, OGG, WAV ou M4A de até 1 MB. Sons longos são cortados em 6 segundos. Todo mundo do servidor pode usar.</p>
      <label>Arquivo de áudio<input type="file" accept="audio/*" onChange={(e) => pick(e.target.files?.[0])} /></label>
      <label>Nome do som<input value={name} maxLength={32} placeholder="ex.: risada do Jacques" onChange={(e) => setName(e.target.value)} /></label>
      <span className="field-label">Emoji</span>
      <div className="emoji-pick">
        {EMOJI_CHOICES.map((e) => <button key={e} className={emoji === e ? 'active' : ''} onClick={() => setEmoji(emoji === e ? '' : e)}>{e}</button>)}
        <input value={emoji} maxLength={8} placeholder="outro" aria-label="Outro emoji" onChange={(e) => setEmoji(e.target.value)} />
      </div>
      <span className="field-label">Volume do som: {volume}%</span>
      <div className="row gap">
        <input type="range" className="plain-range" min={5} max={100} step={5} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
        <button className="btn small" disabled={!file} onClick={preview}><Play size={14} /> Ouvir</button>
      </div>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}

