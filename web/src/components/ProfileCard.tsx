import { MessageCircle, MoreHorizontal, Pencil, Phone, UserCheck, UserPlus, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore, set, memberName, memberColor } from '../lib/store';
import { api, assetUrl } from '../lib/api';
import { joinCall } from '../lib/voice';
import { StyledName, isLightTheme, profileBackground } from '../lib/nameStyle';
import type { Channel, User } from '../lib/types';
import { Avatar, STATUS_LABEL, colorFor } from './Avatar';
import { closeModal, openModal } from './Modal';
import { UserMenu, openMenu } from './ContextMenu';
import { UserSettings } from './modals/UserSettings';
import { Mural } from './Mural';
import { BadgeRow } from './Badges';
import { ActivityCard } from './Activity';

const longDate = (d: string | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * The look of a profile: banner, avatar, styled name and the profile colors, which tint the whole
 * card. Used by the full profile, the panel popout and the live preview in settings.
 */
export function ProfileView({ user, name, nameColor, status, customStatus, actions, children, compact }: {
  user: User; name: string; nameColor?: string; status: string; customStatus?: string;
  actions?: ReactNode; children?: ReactNode; compact?: boolean;
}) {
  const colors = user.profileColors ?? [];
  const live = useStore((s) => s.presence[user.id]);
  const activity = live ? live.activity : user.activity;
  const theme = profileBackground(colors);
  const style = (theme ? { '--pc-theme': theme, '--pc-c1': colors[0] } : {}) as CSSProperties;
  const banner = user.bannerUrl
    ? { backgroundImage: `url("${assetUrl(user.bannerUrl)}")` }
    : { background: colors[0] ?? colorFor(user.id) };
  return (
    <div className={`profile-card ${theme ? 'themed' : ''} ${theme && isLightTheme(colors) ? 'light' : ''} ${compact ? 'compact' : ''}`} style={style}>
      <div className="profile-card-inner">
        <div className="pc-banner" style={banner} />
        <div className="pc-top">
          <Avatar user={user} size={compact ? 76 : 96} showStatus />
          {actions && <div className="pc-actions">{actions}</div>}
        </div>
        <div className="pc-body">
          <div className="pc-name"><StyledName user={user} fallbackColor={nameColor}>{name}</StyledName><BadgeRow user={user} /></div>
          <div className="pc-handle">
            <span>{user.username}</span>
            {user.pronouns && <><span className="dot">•</span><span>{user.pronouns}</span></>}
            <span className="dot">•</span><span>{STATUS_LABEL[status] ?? status}</span>
          </div>
          {customStatus && <div className="pc-status">{customStatus}</div>}
          {activity && <ActivityCard activity={activity} />}
          {children}
        </div>
      </div>
    </div>
  );
}

type FullUser = User & { mutualServerIds: string[]; mutualFriendIds?: string[]; note?: string };

/** Full profile: the card on the left, the mural (widgets) and what you have in common on the right. */
export function ProfileCard({ userId, serverId }: { userId: string; serverId: string | null }) {
  const [user, setUser] = useState<FullUser | null>(null);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'mural' | 'servers' | 'friends'>('mural');
  const me = useStore((s) => s.me);
  const relationships = useStore((s) => s.relationships);
  const relationship = relationships.find((r) => r.user.id === userId);
  const presence = useStore((s) => s.presence[userId]);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const servers = useStore((s) => s.servers);
  // Our own profile follows live edits; anyone else's comes from the server once.
  const live = useStore((s) => (s.me?.id === userId ? s.me : null));
  useEffect(() => { api<FullUser>(`/users/${userId}`).then((u) => { setUser(u); setNote(u.note ?? ''); }).catch(() => closeModal()); }, [userId]);
  if (!user) return <div className="profile-full loading" role="dialog" aria-label="Perfil"><p className="muted">Carregando…</p></div>;

  const shown = live ? { ...user, ...live } : user;
  const member = server?.members.find((m) => m.user.id === userId);
  const roles = (server?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? []).filter((r) => !r.isDefault);
  const isMe = me?.id === userId;
  const name = serverId ? memberName(serverId, shown) : shown.displayName;
  const widgets = shown.widgets ?? [];
  const mutualServers = user.mutualServerIds.map((id) => servers[id]).filter(Boolean);
  const mutualFriends = (user.mutualFriendIds ?? []).map((id) => relationships.find((r) => r.user.id === id)?.user).filter((u): u is User => !!u);

  async function openDm() {
    const dm = await api<Channel>('/dms', { body: { userIds: [userId] } });
    set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id }, openThreadId: null }));
    closeModal();
    return dm;
  }

  const actions = isMe
    ? <button className="btn" onClick={() => openModal(<UserSettings />)}><Pencil size={15} /> Editar perfil</button>
    : <>
      <button className="btn primary" onClick={() => void openDm()}><MessageCircle size={16} /> Mensagem</button>
      <button className="pc-icon-btn" title="Ligar" aria-label="Ligar" onClick={async () => { const dm = await openDm(); void joinCall(dm.id); }}><Phone size={17} /></button>
      {!relationship && <button className="pc-icon-btn" title="Adicionar amigo" aria-label="Adicionar amigo" onClick={() => api(`/relationships/${userId}`, { method: 'PUT' })}><UserPlus size={17} /></button>}
      {relationship?.type === 'incoming' && <button className="pc-icon-btn" title="Aceitar pedido de amizade" aria-label="Aceitar pedido de amizade" onClick={() => api(`/relationships/${userId}`, { method: 'PUT' })}><UserCheck size={17} /></button>}
      <button className="pc-icon-btn" title="Mais" aria-label="Mais opções" onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() { e.stopPropagation(); } }, <UserMenu userId={userId} serverId={serverId} />);
      }}><MoreHorizontal size={18} /></button>
    </>;

  return (
    <div className="profile-full" role="dialog" aria-label={`Perfil de ${name}`}>
      <button className="close-x" onClick={closeModal} aria-label="Fechar"><X size={18} /></button>
      <ProfileView user={shown} name={name} nameColor={memberColor(serverId, userId)} status={presence?.status ?? 'offline'}
        customStatus={presence?.customStatus} actions={actions}>
        {shown.bio && <div className="pc-section"><h4>Sobre mim</h4><p className="pc-bio">{shown.bio}</p></div>}
        <div className="pc-section">
          <h4>Membro desde</h4>
          <p className="small">Voka: {longDate(user.createdAt)}{member && server ? <> · {server.name}: {longDate(member.joinedAt)}</> : null}</p>
        </div>
        {roles.length > 0 && (
          <div className="pc-section"><h4>Cargos</h4>
            <div className="role-chips">{roles.map((r) => <span key={r.id} className="role-chip"><i style={{ background: r.color }} />{r.name}</span>)}</div>
          </div>
        )}
        {!isMe && (
          <div className="pc-section"><h4>Nota (só você vê)</h4>
            <textarea className="note-input" rows={2} maxLength={256} placeholder="Clique para adicionar uma nota" value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (note !== (user.note ?? '')) void api(`/users/${userId}/note`, { method: 'PUT', body: { note } }).then(() => setUser({ ...user, note })); }} />
          </div>
        )}
        {relationship?.type === 'blocked' && <p className="small" style={{ marginTop: 12 }}>Você bloqueou essa pessoa.</p>}
      </ProfileView>

      <div className="profile-side">
        <nav className="profile-tabs">
          <button className={tab === 'mural' ? 'active' : ''} onClick={() => setTab('mural')}>Mural</button>
          {!isMe && <button className={tab === 'servers' ? 'active' : ''} onClick={() => setTab('servers')}>Servidores em comum ({mutualServers.length})</button>}
          {!isMe && <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>Amigos em comum ({mutualFriends.length})</button>}
        </nav>
        <div className="profile-side-body">
          {tab === 'mural' && (widgets.length
            ? <Mural widgets={widgets} />
            : <div className="mural-empty">
              <p className="muted">{isMe ? 'Seu mural está vazio. Mostre seu jogo favorito e os jogos que você curte.' : 'Nada no mural por enquanto.'}</p>
              {isMe && <button className="btn primary" onClick={() => openModal(<UserSettings />)}>Adicionar widget</button>}
            </div>)}
          {tab === 'servers' && (mutualServers.length
            ? mutualServers.map((s) => (
              <button key={s.id} className="list-row" onClick={() => { set({ view: { kind: 'server', serverId: s.id } }); closeModal(); }}>
                <span className="mini-server-icon">{s.iconUrl ? <img src={assetUrl(s.iconUrl)} alt="" /> : s.name.slice(0, 2).toUpperCase()}</span>{s.name}
              </button>))
            : <p className="muted">Nenhum servidor em comum.</p>)}
          {tab === 'friends' && (mutualFriends.length
            ? mutualFriends.map((f) => (
              <button key={f.id} className="list-row" onClick={() => openModal(<ProfileCard userId={f.id} serverId={null} />)}>
                <Avatar user={f} size={32} showStatus /><StyledName user={f}>{f.displayName}</StyledName>
              </button>))
            : <p className="muted">Nenhum amigo em comum.</p>)}
        </div>
      </div>
    </div>
  );
}
