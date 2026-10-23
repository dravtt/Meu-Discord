import { useRef, useState } from 'react';
import { useClickOutside } from './ContextMenu';
import { useSpeaking } from '../lib/speaking';
import { useStore, set, findChannel } from '../lib/store';
import { api } from '../lib/api';
import { Headphones, HeadphoneOff, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Settings, Signal, Video, VideoOff } from 'lucide-react';
import { leaveCall, toggleDeafen, toggleMute, toggleScreen, toggleVideo, useCall } from '../lib/voice';
import type { Status } from '../lib/types';
import { Avatar, STATUS_LABEL } from './Avatar';
import { openModal } from './Modal';
import { UserSettings } from './modals/UserSettings';

export function UserPanel() {
  const me = useStore((s) => s.me);
  const muted = useCall((s) => s.muted);
  const deafened = useCall((s) => s.deafened);
  const [menu, setMenu] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeStatus = useRef(() => setMenu(false)).current;
  useClickOutside(panelRef, menu, closeStatus);
  const speaking = useSpeaking((s) => (me ? !!s[me.id] : false));
  if (!me) return null;

  async function setStatus(status: Status) {
    const updated = await api('/users/@me', { method: 'PATCH', body: { status } });
    set((s) => ({ me: updated, presence: { ...s.presence, [me!.id]: { status, customStatus: updated.customStatus } } }));
    setMenu(false);
  }

  return (
    <div className="user-panel">
      <div ref={panelRef} className="status-anchor">
      {menu && (
        <div className="status-menu">
          {(['online', 'idle', 'dnd', 'invisible'] as const).map((st) => (
            <button key={st} onClick={() => setStatus(st)}><span className={`status-dot inline ${st}`} /> {STATUS_LABEL[st]}</button>
          ))}
        </div>
      )}
      <button className={`me ${speaking ? 'speaking' : ''}`} onClick={() => setMenu(!menu)} title="Alterar status">
        <Avatar user={me} size={32} showStatus />
        <span className="me-names">
          <strong>{me.displayName}</strong>
          <small>{me.customStatus || STATUS_LABEL[me.status]}</small>
        </span>
      </button>
      </div>
      <button className={`icon-btn ${muted ? 'off' : ''}`} title={muted ? 'Ativar microfone' : 'Silenciar'} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>
      <button className={`icon-btn ${deafened ? 'off' : ''}`} title={deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={toggleDeafen}>{deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</button>
      <button className="icon-btn" title="Configurações" onClick={() => openModal(<UserSettings />)}><Settings size={18} /></button>
    </div>
  );
}

export function VoiceBar() {
  const channelId = useCall((s) => s.channelId);
  const connecting = useCall((s) => s.connecting);
  const error = useCall((s) => s.error);
  const video = useCall((s) => s.video);
  const screen = useCall((s) => s.screen);
  const servers = useStore((s) => s.servers);
  if (!channelId && !error) return null;
  const channel = findChannel(channelId ?? undefined);
  const server = channel?.serverId ? servers[channel.serverId] : undefined;
  const where = channel ? (server ? `${channel.name} / ${server.name}` : channel.name || 'Chamada') : '';
  const open = () => channel && set(channel.serverId ? { view: { kind: 'server', serverId: channel.serverId, channelId: channel.id } } : { view: { kind: 'home', dmId: channel.id } });

  return (
    <div className="voice-bar">
      <div className="voice-bar-top">
        <Signal size={18} className={error ? 'error' : connecting ? 'warn' : 'ok'} />
        <button className="voice-bar-info" onClick={open} title="Abrir chamada">
          <strong className={error ? 'error' : connecting ? 'warn' : 'ok'}>{error ? 'Falha na voz' : connecting ? 'Conectando…' : 'Voz conectada'}</strong>
          <small>{error ?? where}</small>
        </button>
        <button className="icon-btn danger" title="Desconectar" onClick={() => (error && !channelId ? useCall.setState({ error: null }) : leaveCall())}><PhoneOff size={18} /></button>
      </div>
      {channelId && (
        <div className="voice-bar-actions">
          <button className={video ? 'on' : ''} title={video ? 'Desligar câmera' : 'Ligar câmera'} onClick={toggleVideo}>{video ? <Video size={18} /> : <VideoOff size={18} />}</button>
          <button className={screen ? 'on' : ''} title={screen ? 'Parar de transmitir' : 'Compartilhar tela'} onClick={toggleScreen}>{screen ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
        </div>
      )}
    </div>
  );
}
