import { useEffect, useRef } from 'react';
import { useStore, findChannel } from '../lib/store';
import { joinCall, leaveCall, toggleDeafen, toggleMute, toggleScreen, toggleVideo, useCall, type Tile } from '../lib/voice';
import { has, P } from '../lib/permissions';
import { Avatar } from './Avatar';

export function CallView({ channelId, compact }: { channelId: string; compact?: boolean }) {
  const call = useCall();
  const channel = useStore(() => findChannel(channelId));
  const voiceStates = useStore((s) => s.voiceStates);
  const inThisCall = call.channelId === channelId;
  const others = Object.values(voiceStates).filter((v) => v.channelId === channelId);
  const canVideo = !channel?.serverId || has(channel?.permissions, P.VIDEO);

  if (!inThisCall) {
    return (
      <div className={`call ${compact ? 'compact' : ''}`}>
        <div className="call-empty">
          <h2>🔊 {channel?.name || 'Chamada'}</h2>
          <p className="muted">{others.length ? `${others.length} pessoa(s) conectada(s)` : 'Ninguém está aqui ainda.'}</p>
          {call.error && <p className="error">{call.error}</p>}
          <button className="btn primary" onClick={() => joinCall(channelId)}>Entrar na voz</button>
        </div>
      </div>
    );
  }

  const focus = call.tiles.find((t) => t.screen);
  return (
    <div className={`call ${compact ? 'compact' : ''}`}>
      {call.connecting && <p className="muted center">Conectando…</p>}
      {focus && <div className="call-focus"><VideoEl track={focus.screen!} /><span className="tile-name">{focus.name} (tela)</span></div>}
      <div className="call-grid">
        {call.tiles.map((t) => <CallTile key={t.identity} tile={t} />)}
      </div>
      <div className="call-controls">
        <button className={`round ${call.muted ? 'off' : ''}`} title="Microfone" onClick={toggleMute}>{call.muted ? '🎙️̸' : '🎙️'}</button>
        <button className={`round ${call.deafened ? 'off' : ''}`} title="Áudio" onClick={toggleDeafen}>{call.deafened ? '🔇' : '🎧'}</button>
        {canVideo && <button className={`round ${call.video ? 'on' : ''}`} title="Câmera" onClick={toggleVideo}>📷</button>}
        {canVideo && <button className={`round ${call.screen ? 'on' : ''}`} title="Compartilhar tela" onClick={toggleScreen}>🖥️</button>}
        <button className="round danger" title="Desconectar" onClick={() => leaveCall()}>✆</button>
      </div>
    </div>
  );
}

function CallTile({ tile }: { tile: Tile }) {
  const voice = useStore((s) => s.voiceStates[tile.identity]);
  return (
    <div className={`call-tile ${tile.speaking ? 'speaking' : ''}`}>
      {tile.video ? <VideoEl track={tile.video} /> : <Avatar user={{ id: tile.identity, displayName: tile.name, avatarUrl: null }} size={72} />}
      <span className="tile-name">{tile.name} {voice?.deafened ? '🔇' : voice?.muted ? '🎙️̸' : ''}</span>
    </div>
  );
}

function VideoEl({ track }: { track: MediaStreamTrack }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = new MediaStream([track]);
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted />;
}
