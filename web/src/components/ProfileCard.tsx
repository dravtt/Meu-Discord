import { MessageCircle, MoreHorizontal, Pencil, Phone, UserCheck, UserPlus, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useStore, set, memberName, memberColor } from '../lib/store';
import { api, assetUrl } from '../lib/api';
import { joinCall } from '../lib/voice';
import { StyledName, profileBackground } from '../lib/nameStyle';
import type { Channel, User } from '../lib/types';
import { Avatar, STATUS_LABEL, colorFor } from './Avatar';
import { Dialog, closeModal, openModal } from './Modal';
import { UserMenu, openMenu } from './ContextMenu';
import { UserSettings } from './modals/UserSettings';

const longDate = (d: string | undefined) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * The look of a profile: banner, avatar, styled name and the profile colors. Used by the profile
 * card and by the live preview in settings, so both always match.
 */
export function ProfileView({ user, name, nameColor, status, customStatus, actions, children, onClose }: {
  user: User; name: string; nameColor?: string; status: string; customStatus?: string;
  actions?: ReactNode; children?: ReactNode; onClose?: () => void;
}) {
  const colors = user.profileColors ?? [];
  const theme = profileBackground(colors);
  const style = (theme ? { '--pc-theme': theme, '--pc-c1': colors[0] } : {}) as CSSProperties;
  const banner = user.bannerUrl
    ? { backgroundImage: `url("${assetUrl(user.bannerUrl)}")` }
    : { background: colors[0] ?? colorFor(user.id) };
  return (
    <div className={`profile-card ${theme ? 'themed' : ''}`} style={style} role="dialog" aria-label={`Perfil de ${name}`}>
      {onClose && <button className="close-x" onClick={onClose} aria-label="Fechar"><X size={18} /></button>}
      <div className="profile-card-inner">
        <div className="pc-banner" style={banner} />
        <div className="pc-top">
          <Avatar user={user} size={96} showStatus />
          {actions && <div className="pc-actions">{actions}</div>}
        </div>
        <div className="pc-body">
          <div className="pc-name"><StyledName user={user} fallbackColor={nameColor}>{name}</StyledName></div>
          <div className="pc-handle">
            <span>{user.username}</span>
            {user.pronouns && <><span className="dot">•</span><span>{user.pronouns}</span></>}
            <span className="dot">•</span><span>{STATUS_LABEL[status] ?? status}</span>
          </div>
          {customStatus && <div className="pc-status">{customStatus}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function ProfileCard({ userId, serverId }: { userId: string; serverId: string | null }) {
  const [user, setUser] = useState<(User & { mutualServerIds: string[]; note?: string }) | null>(null);
  const [note, setNote] = useState('');
  const me = useStore((s) => s.me);
  const relationship = useStore((s) => s.relationships.find((r) => r.user.id === userId));
  const presence = useStore((s) => s.presence[userId]);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const servers = useStore((s) => s.servers);
  // Our own profile follows live edits; anyone else's comes from the server once.
  const live = useStore((s) => (s.me?.id === userId ? s.me : null));
  useEffect(() => { api(`/users/${userId}`).then((u) => { setUser(u); setNote(u.note ?? ''); }).catch(() => closeModal()); }, [userId]);
  if (!user) return <Dialog title="Perfil"><p className="muted">Carregando…</p></Dialog>;

  const shown = live ? { ...user, ...live } : user;
  const member = server?.members.find((m) => m.user.id === userId);
  const roles = (server?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? []).filter((r) => !r.isDefault);
  const isMe = me?.id === userId;
  const name = serverId ? memberName(serverId, shown) : shown.displayName;

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

  const mutual = user.mutualServerIds.map((id) => servers[id]?.name).filter(Boolean);

  return (
    <ProfileView user={shown} name={name} nameColor={memberColor(serverId, userId)} status={presence?.status ?? 'offline'}
      customStatus={presence?.customStatus} actions={actions} onClose={closeModal}>
      {shown.bio && <div className="pc-section"><h4>Sobre mim</h4><p className="pc-bio">{shown.bio}</p></div>}
      <div className="pc-section">
        <h4>Membro desde</h4>
        <p className="muted small">Nexo: {longDate(user.createdAt)}{member && server ? <> · {server.name}: {longDate(member.joinedAt)}</> : null}</p>
      </div>
      {roles.length > 0 && (
        <div className="pc-section"><h4>Cargos</h4>
          <div className="role-chips">{roles.map((r) => <span key={r.id} className="role-chip"><i style={{ background: r.color }} />{r.name}</span>)}</div>
        </div>
      )}
      {!isMe && mutual.length > 0 && (
        <div className="pc-section"><h4>Servidores em comum ({mutual.length})</h4>
          <div className="pc-servers">{mutual.map((n) => <span key={n}>{n}</span>)}</div>
        </div>
      )}
      {!isMe && (
        <div className="pc-section"><h4>Nota (só você vê)</h4>
          <textarea className="note-input" rows={2} maxLength={256} placeholder="Clique para adicionar uma nota" value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== (user.note ?? '')) void api(`/users/${userId}/note`, { method: 'PUT', body: { note } }).then(() => setUser({ ...user, note })); }} />
        </div>
      )}
      {relationship?.type === 'blocked' && <p className="muted small" style={{ marginTop: 12 }}>Você bloqueou essa pessoa.</p>}
    </ProfileView>
  );
}
