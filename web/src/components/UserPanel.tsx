import { useRef, useState } from 'react';
import { useClickOutside } from './ContextMenu';
import { useSpeaking } from '../lib/speaking';
import { openScreenShare } from './ScreenShareModal';
import { toggleSoundboard, useSoundboardOpen } from './Soundboard';
import { useStore, set, findChannel } from '../lib/store';
import { api } from '../lib/api';
import { Award, ChevronRight, Gamepad2, Headphones, HeadphoneOff, Mic, MicOff, MonitorOff, MonitorUp, PartyPopper, Pencil, PhoneOff, Plus, Settings, Copy, UserRound, Users, Signal, Video, VideoOff } from 'lucide-react';
import { leaveCall, toggleDeafen, toggleMute, toggleVideo, useCall } from '../lib/voice';
import type { Status } from '../lib/types';
import { Avatar, STATUS_LABEL, StatusIcon } from './Avatar';
import { openModal } from './Modal';
import { UserSettings } from './modals/UserSettings';
import { StyledName } from '../lib/nameStyle';
import { ProfileCard, ProfileView } from './ProfileCard';
import { ActivityDialog } from './Activity';
import { BadgesDialog } from './Badges';
import { addAccount, savedAccounts, switchTo } from '../lib/accounts';

const STATUS_HINT: Record<string, string> = {
  idle: '',
  dnd: 'Você não vai receber notificações na área de trabalho',
  invisible: 'Você vai aparecer offline',
};

export function UserPanel() {
  const me = useStore((s) => s.me);
  const muted = useCall((s) => s.muted);
  const deafened = useCall((s) => s.deafened);
  const [menu, setMenu] = useState(false);
  const [sub, setSub] = useState<{ kind: 'status' | 'accounts'; top: number; left: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeStatus = useRef(() => { setMenu(false); setSub(null); }).current;
  useClickOutside(panelRef, menu, closeStatus);
  const speaking = useSpeaking((s) => (me ? !!s[me.id] : false));
  const status = useStore((s) => (me ? s.presence[me.id]?.status ?? me.status : 'offline'));
  const activity = useStore((s) => (me ? s.presence[me.id]?.activity : null));
  if (!me) return null;

  async function setStatus(status: Status) {
    const updated = await api('/users/@me', { method: 'PATCH', body: { status } });
    set((s) => ({ me: updated, presence: { ...s.presence, [me!.id]: { status, customStatus: updated.customStatus } } }));
    closeStatus();
  }

  /** Opens a submenu beside the row that was hovered or clicked. */
  const openSub = (kind: 'status' | 'accounts') => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSub({ kind, top: Math.min(r.top - 6, window.innerHeight - 260), left: r.right + 8 });
  };
  const go = (fn: () => void) => () => { closeStatus(); fn(); };
  const others = savedAccounts().filter((a) => a.id !== me.id);

  return (
    <div className="user-panel">
      <div ref={panelRef} className="status-anchor">
      {menu && (
        <div className="me-popout">
          <ProfileView user={me} name={me.displayName} status={status} customStatus={me.customStatus} compact>
            {me.bio && <div className="pc-section"><p className="pc-bio">{me.bio}</p></div>}
            <div className="me-box">
              <button onMouseEnter={() => setSub(null)} onClick={go(() => openModal(<UserSettings />))}><Pencil size={16} /> Editar perfil</button>
              <button className={`has-sub ${sub?.kind === 'status' ? 'open' : ''}`} onMouseEnter={openSub('status')} onClick={openSub('status')}>
                <StatusIcon status={status} inline /> {STATUS_LABEL[status]} <ChevronRight size={16} className="chev" />
              </button>
              <button onMouseEnter={() => setSub(null)} onClick={go(() => openModal(<ActivityDialog />))}>
                <Gamepad2 size={16} /> <span className="ellipsis">{activity ? `Jogando ${activity.name}` : 'Definir jogo'}</span>
              </button>
              <button onMouseEnter={() => setSub(null)} onClick={go(() => openModal(<BadgesDialog />))}><Award size={16} /> Insígnias</button>
              <button onMouseEnter={() => setSub(null)} onClick={go(() => openModal(<ProfileCard userId={me.id} serverId={null} />))}><UserRound size={16} /> Ver perfil completo</button>
            </div>
            <div className="me-box">
              <button className={`has-sub ${sub?.kind === 'accounts' ? 'open' : ''}`} onMouseEnter={openSub('accounts')} onClick={openSub('accounts')}>
                <Users size={16} /> Mudar de conta <ChevronRight size={16} className="chev" />
              </button>
              <button onMouseEnter={() => setSub(null)} onClick={go(() => { void navigator.clipboard?.writeText(me.id); })}><Copy size={16} /> Copiar ID do usuário</button>
            </div>
          </ProfileView>
          {sub && (
            <div className="me-sub" style={{ top: sub.top, left: sub.left }} onMouseLeave={() => setSub(null)}>
              {sub.kind === 'status'
                ? (['online', 'idle', 'dnd', 'invisible'] as const).map((st) => (
                  <button key={st} className={status === st ? 'active' : ''} onClick={() => void setStatus(st)}>
                    <StatusIcon status={st} inline />
                    <span><strong>{STATUS_LABEL[st]}</strong>{STATUS_HINT[st] && <small>{STATUS_HINT[st]}</small>}</span>
                  </button>))
                : <>
                  <button className="active" disabled><Avatar user={me} size={24} /> <span><strong>{me.displayName}</strong><small>Conta atual</small></span></button>
                  {others.map((a) => (
                    <button key={a.id} onClick={() => switchTo(a)}><Avatar user={{ id: a.id, displayName: a.displayName, avatarUrl: a.avatarUrl }} size={24} /> <span><strong>{a.displayName}</strong><small>{a.username}</small></span></button>
                  ))}
                  <div className="ctx-sep" />
                  <button onClick={addAccount}><Plus size={16} /> Adicionar conta</button>
                </>}
            </div>
          )}
        </div>
      )}
      <button className={`me ${speaking ? 'speaking' : ''}`} onClick={() => { setMenu(!menu); setSub(null); }} title="Seu perfil e status">
        <Avatar user={me} size={32} showStatus />
        <span className="me-names">
          <strong><StyledName user={me}>{me.displayName}</StyledName></strong>
          <small>{activity ? `Jogando ${activity.name}` : me.customStatus || STATUS_LABEL[status]}</small>
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
  const soundboard = useSoundboardOpen();
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
          <button className={screen ? 'on' : ''} title={screen ? 'Parar de transmitir' : 'Compartilhar tela'} onClick={openScreenShare}>{screen ? <MonitorOff size={18} /> : <MonitorUp size={18} />}</button>
          <button className={soundboard ? 'on' : ''} title="Efeitos sonoros" onClick={toggleSoundboard}><PartyPopper size={18} /></button>
        </div>
      )}
    </div>
  );
}
