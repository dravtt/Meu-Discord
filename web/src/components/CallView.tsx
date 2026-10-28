import { useEffect, useRef, useState } from 'react';
import { Headphones, HeadphoneOff, Maximize2, Mic, PartyPopper, MicOff, Minimize2, Monitor, MonitorOff, MonitorUp, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import type { Track } from 'livekit-client';
import { useStore, useUser, findChannel, dmName } from '../lib/store';
import { joinCall, leaveCall, toggleDeafen, toggleMute, toggleVideo, useCall, type Tile } from '../lib/voice';
import { has, P } from '../lib/permissions';
import { useSpeaking } from '../lib/speaking';
import { openScreenShare } from './ScreenShareModal';
import { toggleSoundboard, useSoundboardOpen } from './Soundboard';
import { useSoundBubbles } from '../lib/soundboard';
import { userMenuProps } from './ContextMenu';
import { Avatar } from './Avatar';

/** Tracks which element (if any) is fullscreen, so buttons can show the right icon. */
function useFullscreenElement() {
  const [el, setEl] = useState<Element | null>(document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setEl(document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return el;
}

function toggleFullscreen(el: Element | null) {
  if (!el) return;
  if (document.fullscreenElement === el) void document.exitFullscreen();
  else void el.requestFullscreen().catch(() => {});
}

export function CallView({ channelId, compact }: { channelId: string; compact?: boolean }) {
  const call = useCall();
  const channel = useStore(() => findChannel(channelId));
  const voiceStates = useStore((s) => s.voiceStates);
  const me = useStore((s) => s.me);
  const stageRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreenElement();
  const soundboard = useSoundboardOpen();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // True when the spotlight was picked by a click, so a screen ending does not take it away.
  const manualFocus = useRef(false);
  const inThisCall = call.channelId === channelId;
  const others = Object.values(voiceStates).filter((v) => v.channelId === channelId);
  const canVideo = !channel?.serverId || has(channel?.permissions, P.VIDEO);

  // A new screen share takes the spotlight automatically, like most call apps.
  const screenKeys = call.tiles.filter((t) => t.screen).map((t) => t.key).join();
  useEffect(() => {
    const firstScreen = call.tiles.find((t) => t.screen && !t.local) ?? call.tiles.find((t) => t.screen);
    setFocusKey((k) => {
      const current = call.tiles.find((t) => t.key === k);
      if (current && (current.screen || manualFocus.current)) return k;
      // The shared screen ended (or its owner left): go back to the next screen, or to the grid.
      manualFocus.current = false;
      return firstScreen?.key ?? null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKeys]);

  if (!inThisCall) {
    return (
      <div className={`call ${compact ? 'compact' : ''}`}>
        <div className="call-empty">
          <div className="call-empty-icon"><Volume2 size={36} /></div>
          <h2>{channel?.name || 'Chamada'}</h2>
          <p className="muted">{others.length ? `${others.length} pessoa(s) na sala` : 'Ninguém está aqui ainda.'}</p>
          {call.error && <p className="error">{call.error}</p>}
          <button className="btn primary" onClick={() => joinCall(channelId)}>Entrar na voz</button>
        </div>
      </div>
    );
  }

  const focus = call.tiles.find((t) => t.key === focusKey);
  const rest = focus ? call.tiles.filter((t) => t !== focus) : call.tiles;
  const n = rest.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.max(1, Math.ceil(n / cols));
  const isFull = fullscreen === stageRef.current && !!fullscreen;

  return (
    <div className={`call ${compact ? 'compact' : ''}`} ref={stageRef}>
      {call.connecting ? <div className="call-status">Conectando…</div>
        : call.ringing && <div className="call-status ringing">Chamando {channel?.type === 'dm' ? dmName(channel, me?.id) : 'o grupo'}…</div>}
      {focus ? (
        <div className="call-stage focused">
          <CallTile tile={focus} big onFocus={() => { manualFocus.current = false; setFocusKey(null); }} />
          {rest.length > 0 && <div className="call-strip">{rest.map((t) => <CallTile key={t.key} tile={t} onFocus={() => { manualFocus.current = true; setFocusKey(t.key); }} />)}</div>}
        </div>
      ) : (
        <div className="call-stage grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
          {rest.map((t) => <CallTile key={t.key} tile={t} onFocus={() => { manualFocus.current = true; setFocusKey(t.key); }} />)}
        </div>
      )}
      <div className="call-controls">
        <button className={`round ${call.muted ? 'off' : ''}`} title={call.muted ? 'Ativar microfone' : 'Silenciar'} onClick={toggleMute}>
          {call.muted ? <MicOff size={22} /> : <Mic size={22} />}
        </button>
        <button className={`round ${call.deafened ? 'off' : ''}`} title={call.deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={toggleDeafen}>
          {call.deafened ? <HeadphoneOff size={22} /> : <Headphones size={22} />}
        </button>
        {canVideo && (
          <button className={`round ${call.video ? 'on' : ''}`} title={call.video ? 'Desligar câmera' : 'Ligar câmera'} onClick={toggleVideo}>
            {call.video ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
        )}
        {canVideo && (
          <button className={`round ${call.screen ? 'on' : ''}`} title={call.screen ? 'Parar de transmitir' : 'Compartilhar tela'} onClick={openScreenShare}>
            {call.screen ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
          </button>
        )}
        <button className={`round ${soundboard ? 'on' : ''}`} title="Efeitos sonoros" onClick={toggleSoundboard}><PartyPopper size={22} /></button>
        <button className="round" title={isFull ? 'Sair da tela cheia' : 'Tela cheia'} onClick={() => toggleFullscreen(stageRef.current)}>
          {isFull ? <Minimize2 size={22} /> : <Maximize2 size={22} />}
        </button>
        <button className="round danger" title="Desconectar" onClick={() => leaveCall()}><PhoneOff size={22} /></button>
      </div>
    </div>
  );
}

function CallTile({ tile, big, onFocus }: { tile: Tile; big?: boolean; onFocus: () => void }) {
  const voice = useStore((s) => s.voiceStates[tile.identity]);
  const speaking = useSpeaking((s) => !!s[tile.identity]);
  const bubble = useSoundBubbles((s) => s[tile.identity]);
  const channelServer = useStore((s) => (s.voiceStates[tile.identity]?.serverId ?? null));
  const ref = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreenElement();
  const isFull = !!fullscreen && fullscreen === ref.current;
  const main = tile.screen ?? tile.camera;
  const isScreen = !!tile.screen;
  const known = useUser(tile.identity);
  const person = { id: tile.identity, displayName: known?.displayName ?? tile.name, avatarUrl: known?.avatarUrl ?? null };

  return (
    <div ref={ref} className={`call-tile ${isScreen ? 'screen' : ''} ${speaking ? 'speaking' : ''} ${big ? 'big' : ''}`}
      data-identity={tile.identity} {...userMenuProps(tile.identity, channelServer)}
      onClick={onFocus} onDoubleClick={() => toggleFullscreen(ref.current)}
      title={big ? 'Clique para voltar à grade, clique duas vezes para tela cheia' : 'Clique para destacar, clique duas vezes para tela cheia'}>
      {main
        ? <VideoEl track={main} fit={isScreen ? 'contain' : 'cover'} mirror={tile.local && !isScreen} />
        : <div className="tile-avatar"><Avatar user={person} size={big ? 96 : 72} /></div>}
      {isScreen && (
        <div className="tile-pip">
          {tile.camera
            ? <VideoEl track={tile.camera} fit="cover" mirror={tile.local} />
            : <Avatar user={person} size={big ? 48 : 32} />}
        </div>
      )}
      <span className="tile-name">
        {isScreen && <Monitor size={14} />}
        {tile.name}
        {voice?.deafened ? <HeadphoneOff size={14} className="tile-flag" /> : voice?.muted ? <MicOff size={14} className="tile-flag" /> : null}
      </span>
      {isScreen && <span className="live tile-live">AO VIVO</span>}
      {bubble && <span key={bubble.at} className="sound-bubble" title={bubble.name}>{bubble.emoji}</span>}
      <button className="tile-full" title={isFull ? 'Sair da tela cheia' : 'Tela cheia'} onClick={(e) => { e.stopPropagation(); toggleFullscreen(ref.current); }}>
        {isFull ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}

/**
 * Attaching through LiveKit (not a raw srcObject) lets adaptive streaming see how big the
 * video is on screen, so a large or fullscreen tile receives the full-quality layer.
 */
function VideoEl({ track, fit, mirror }: { track: Track; fit: 'cover' | 'contain'; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted style={{ objectFit: fit, transform: mirror ? 'scaleX(-1)' : undefined }} />;
}
