import { ChevronDown, ChevronRight, Hash, HeadphoneOff, MicOff, Plus, Settings, Users, Video, Volume2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useState } from 'react';
import { useStore, set, dmName, memberName } from '../lib/store';
import { has, P } from '../lib/permissions';
import type { Channel, Server } from '../lib/types';
import { api } from '../lib/api';
import { joinCall, useCall } from '../lib/voice';
import { Avatar } from './Avatar';
import { openModal, confirmDialog, Dialog, closeModal } from './Modal';
import { CreateChannelModal, InviteModal } from './modals/ServerModals';
import { ServerSettings } from './modals/ServerSettings';
import { ChannelSettings } from './modals/ChannelSettings';
import { NewGroupModal } from './modals/NewGroupModal';
import { UserPanel, VoiceBar } from './UserPanel';

export function Sidebar() {
  const view = useStore((s) => s.view);
  const server = useStore((s) => (s.view.kind === 'server' ? s.servers[s.view.serverId] : undefined));
  return (
    <aside className="sidebar">
      {view.kind === 'home' || !server ? <HomeSidebar /> : <ServerSidebar server={server} />}
      <VoiceBar />
      <UserPanel />
    </aside>
  );
}

function HomeSidebar() {
  const dms = useStore(useShallow((s) => Object.values(s.dms).sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))));
  const me = useStore((s) => s.me);
  const view = useStore((s) => s.view);
  const readStates = useStore((s) => s.readStates);
  const pending = useStore((s) => s.relationships.filter((r) => r.type === 'incoming').length);
  const activeDm = view.kind === 'home' ? view.dmId : undefined;

  return (
    <>
      <header className="sidebar-header"><span className="search-hint">Conversas</span></header>
      <div className="sidebar-scroll">
        <button className={`nav-item ${!activeDm ? 'active' : ''}`} onClick={() => set({ view: { kind: 'home' } })}>
          <Users size={20} className="nav-icon" /> Amigos {pending > 0 && <span className="badge inline">{pending}</span>}
        </button>
        <div className="section-title">
          <span>Mensagens diretas</span>
          <button className="icon-btn small" title="Criar grupo" onClick={() => openModal(<NewGroupModal />)}><Plus size={16} /></button>
        </div>
        {dms.map((dm) => {
          const other = dm.type === 'dm' ? dm.recipients?.find((u) => u.id !== me?.id) : undefined;
          const rs = readStates[dm.id];
          return (
            <button key={dm.id} className={`dm-item ${activeDm === dm.id ? 'active' : ''} ${rs?.unread ? 'unread' : ''}`}
              onClick={() => set({ view: { kind: 'home', dmId: dm.id } })}>
              {other ? <Avatar user={other} size={32} showStatus /> : <span className="group-icon">{(dm.recipients?.length ?? 0)}</span>}
              <span className="dm-name">{dmName(dm, me?.id)}</span>
              {!!rs?.mentions && <span className="badge inline">{rs.mentions}</span>}
            </button>
          );
        })}
        {dms.length === 0 && <p className="muted small pad">Nenhuma conversa ainda. Comece uma pela lista de amigos.</p>}
      </div>
    </>
  );
}

function ServerSidebar({ server }: { server: Server }) {
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const me = useStore((s) => s.me);
  const view = useStore((s) => s.view);
  const readStates = useStore((s) => s.readStates);
  const voiceStates = useStore((s) => s.voiceStates);
  const activeId = view.kind === 'server' ? view.channelId : undefined;
  const isOwner = server.ownerId === me?.id;

  const categories = server.channels.filter((c) => c.type === 'category').sort((a, b) => a.position - b.position);
  const childrenOf = (parentId: string | null) => server.channels
    .filter((c) => c.type !== 'category' && c.parentId === parentId)
    .sort((a, b) => (a.type === b.type ? a.position - b.position : a.type === 'text' ? -1 : 1));

  const menuItems: [string, () => void, boolean, boolean?][] = [
    ['Convidar pessoas', () => openModal(<InviteModal serverId={server.id} />), has(server.permissions, P.CREATE_INVITE)],
    ['Configurações do servidor', () => openModal(<ServerSettings serverId={server.id} />), has(server.permissions, P.MANAGE_SERVER) || has(server.permissions, P.MANAGE_ROLES) || has(server.permissions, P.KICK_MEMBERS)],
    ['Criar canal', () => openModal(<CreateChannelModal serverId={server.id} />), has(server.permissions, P.MANAGE_CHANNELS)],
    ['Criar categoria', () => openModal(<CreateChannelModal serverId={server.id} category />), has(server.permissions, P.MANAGE_CHANNELS)],
    ['Alterar apelido', () => openModal(<NicknameModal server={server} />), has(server.permissions, P.CHANGE_NICKNAME)],
    ['Sair do servidor', () => confirmDialog('Sair do servidor', `Tem certeza que quer sair de ${server.name}?`, 'Sair', async () => { await api(`/servers/${server.id}/members/@me`, { method: 'DELETE' }); }), !isOwner, true],
  ];

  const renderChannel = (c: Channel) => {
    const rs = readStates[c.id];
    const inVoice = Object.values(voiceStates).filter((v) => v.channelId === c.id);
    return (
      <div key={c.id}>
        <div className={`channel-item ${activeId === c.id ? 'active' : ''} ${rs?.unread ? 'unread' : ''}`}>
          <button className="channel-btn" onClick={() => {
            if (c.type === 'voice') { set({ view: { kind: 'server', serverId: server.id, channelId: c.id }, openThreadId: null }); void joinCall(c.id); }
            else set({ view: { kind: 'server', serverId: server.id, channelId: c.id }, openThreadId: null });
          }}>
            <span className="channel-icon">{c.type === 'voice' ? <Volume2 size={18} /> : <Hash size={18} />}</span>
            <span className="channel-name">{c.name}</span>
            {!!rs?.mentions && <span className="badge inline">{rs.mentions}</span>}
          </button>
          {has(c.permissions, P.MANAGE_CHANNELS) && (
            <button className="icon-btn small hover-only" title="Editar canal" onClick={() => openModal(<ChannelSettings channelId={c.id} serverId={server.id} />)}><Settings size={15} /></button>
          )}
        </div>
        {inVoice.length > 0 && (
          <div className="voice-users">
            {inVoice.map((v) => {
              const member = server.members.find((m) => m.user.id === v.userId);
              if (!member) return null;
              return (
                <div key={v.userId} className="voice-user">
                  <Avatar user={member.user} size={20} />
                  <span>{memberName(server.id, member.user)}</span>
                  <span className="voice-flags">{v.streaming && <span className="live">AO VIVO</span>}{v.video && <Video size={14} />}{v.deafened ? <HeadphoneOff size={14} /> : v.muted ? <MicOff size={14} /> : null}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <header className="sidebar-header clickable" onClick={() => setMenu(!menu)}>
        <span className="server-title">{server.name}</span>{menu ? <X size={18} /> : <ChevronDown size={18} />}
      </header>
      {menu && (
        <div className="dropdown" onClick={() => setMenu(false)}>
          {menuItems.filter(([, , visible]) => visible).map(([label, action, , danger]) => (
            <button key={label} className={danger ? 'danger' : ''} onClick={action}>{label}</button>
          ))}
        </div>
      )}
      <div className="sidebar-scroll">
        {childrenOf(null).map(renderChannel)}
        {categories.map((cat) => (
          <div key={cat.id} className="category">
            <div className="section-title">
              <button className="category-btn" onClick={() => setCollapsed({ ...collapsed, [cat.id]: !collapsed[cat.id] })}>
                {collapsed[cat.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />} {cat.name}
              </button>
              {has(server.permissions, P.MANAGE_CHANNELS) && (
                <button className="icon-btn small" title="Criar canal" onClick={() => openModal(<CreateChannelModal serverId={server.id} parentId={cat.id} />)}><Plus size={16} /></button>
              )}
            </div>
            {childrenOf(cat.id).filter((c) => !collapsed[cat.id] || c.id === activeId || readStates[c.id]?.unread).map(renderChannel)}
          </div>
        ))}
      </div>
    </>
  );
}

function NicknameModal({ server }: { server: Server }) {
  const me = useStore((s) => s.me)!;
  const current = server.members.find((m) => m.user.id === me.id)?.nickname ?? '';
  const [value, setValue] = useState(current);
  return <NicknameForm serverId={server.id} value={value} setValue={setValue} />;
}

function NicknameForm({ serverId, value, setValue }: { serverId: string; value: string; setValue: (v: string) => void }) {
  return (
    <Dialog title="Alterar apelido" footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn primary" onClick={async () => { await api(`/servers/${serverId}/members/@me`, { method: 'PATCH', body: { nickname: value || null } }); closeModal(); }}>Salvar</button>
    </>}>
      <label>Apelido<input value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} placeholder="Deixe vazio para usar seu nome" autoFocus /></label>
    </Dialog>
  );
}
