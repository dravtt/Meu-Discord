import { useState } from 'react';
import { useStore, set, findChannel } from '../lib/store';
import { api } from '../lib/api';
import { leaveCall, toggleDeafen, toggleMute, useCall } from '../lib/voice';
import type { Status } from '../lib/types';
import { Avatar, STATUS_LABEL } from './Avatar';
import { openModal } from './Modal';
import { UserSettings } from './modals/UserSettings';

export function UserPanel() {
  const me = useStore((s) => s.me);
  const muted = useCall((s) => s.muted);
  const deafened = useCall((s) => s.deafened);
  const [menu, setMenu] = useState(false);
  if (!me) return null;

  async function setStatus(status: Status) {
    const updated = await api('/users/@me', { method: 'PATCH', body: { status } });
    set((s) => ({ me: updated, presence: { ...s.presence, [me!.id]: { status, customStatus: updated.customStatus } } }));
    setMenu(false);
  }

  return (
    <div className="user-panel">
      {menu && (
        <div className="status-menu">
          {(['online', 'idle', 'dnd', 'invisible'] as const).map((st) => (
            <button key={st} onClick={() => setStatus(st)}><span className={`status-dot inline ${st}`} /> {STATUS_LABEL[st]}</button>
          ))}
        </div>
      )}
      <button className="me" onClick={() => setMenu(!menu)} title="Alterar status">
        <Avatar user={me} size={32} showStatus />
        <span className="me-names">
          <strong>{me.displayName}</strong>
          <small>{me.customStatus || STATUS_LABEL[me.status]}</small>
        </span>
      </button>
      <button className={`icon-btn ${muted ? 'off' : ''}`} title={muted ? 'Ativar microfone' : 'Silenciar'} onClick={toggleMute}>{muted ? '🎙️̸' : '🎙️'}</button>
      <button className={`icon-btn ${deafened ? 'off' : ''}`} title={deafened ? 'Ativar áudio' : 'Desativar áudio'} onClick={toggleDeafen}>{deafened ? '🔇' : '🎧'}</button>
      <button className="icon-btn" title="Configurações" onClick={() => openModal(<UserSettings />)}>⚙</button>
    </div>
  );
}

export function VoiceBar() {
  const channelId = useCall((s) => s.channelId);
  const connecting = useCall((s) => s.connecting);
  const error = useCall((s) => s.error);
  useStore((s) => s.servers);
  if (!channelId && !error) return null;
  const channel = findChannel(channelId ?? undefined);
  return (
    <div className="voice-bar">
      <div>
        <strong className={error ? 'error' : 'ok'}>{error ? 'Falha na voz' : connecting ? 'Conectando…' : 'Voz conectada'}</strong>
        <small>{error ?? (channel ? channel.name || 'Chamada' : '')}</small>
      </div>
      {channel && <button className="icon-btn" title="Abrir" onClick={() => set(channel.serverId ? { view: { kind: 'server', serverId: channel.serverId, channelId: channel.id } } : { view: { kind: 'home', dmId: channel.id } })}>↗</button>}
      <button className="icon-btn danger" title="Desconectar" onClick={() => (error && !channelId ? useCall.setState({ error: null }) : leaveCall())}>✆</button>
    </div>
  );
}
