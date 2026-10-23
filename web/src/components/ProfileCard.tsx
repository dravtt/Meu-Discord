import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore, set, memberName } from '../lib/store';
import { api } from '../lib/api';
import type { Channel, User } from '../lib/types';
import { Avatar, STATUS_LABEL, colorFor } from './Avatar';
import { Dialog, closeModal } from './Modal';

export function ProfileCard({ userId, serverId }: { userId: string; serverId: string | null }) {
  const [user, setUser] = useState<(User & { mutualServerIds: string[]; note?: string }) | null>(null);
  const [note, setNote] = useState('');
  const me = useStore((s) => s.me);
  const relationship = useStore((s) => s.relationships.find((r) => r.user.id === userId));
  const presence = useStore((s) => s.presence[userId]);
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const servers = useStore((s) => s.servers);
  useEffect(() => { api(`/users/${userId}`).then((u) => { setUser(u); setNote(u.note ?? ''); }).catch(() => closeModal()); }, [userId]);
  if (!user) return <Dialog title="Perfil"><p className="muted">Carregando…</p></Dialog>;

  const member = server?.members.find((m) => m.user.id === userId);
  const roles = server?.roles.filter((r) => member?.roleIds.includes(r.id)) ?? [];
  const isMe = me?.id === userId;

  async function message() {
    const dm = await api<Channel>('/dms', { body: { userIds: [userId] } });
    set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id }, openThreadId: null }));
    closeModal();
  }

  return (
    <div className="dialog profile">
      <div className="profile-banner" style={{ background: colorFor(user.id) }} />
      <div className="profile-head">
        <Avatar user={user} size={80} showStatus />
        <button className="icon-btn" onClick={closeModal}><X size={20} /></button>
      </div>
      <div className="dialog-body">
        <h2>{serverId ? memberName(serverId, user) : user.displayName}</h2>
        <p className="muted">{user.username} · {STATUS_LABEL[presence?.status ?? 'offline']}</p>
        {presence?.customStatus && <p>{presence.customStatus}</p>}
        {user.bio && <><h4>Sobre mim</h4><p>{user.bio}</p></>}
        {roles.filter((r) => !r.isDefault).length > 0 && (
          <><h4>Cargos</h4><div className="role-chips">{roles.filter((r) => !r.isDefault).map((r) => <span key={r.id} className="role-chip"><i style={{ background: r.color }} />{r.name}</span>)}</div></>
        )}
        {!isMe && user.mutualServerIds.length > 0 && (
          <><h4>Servidores em comum</h4><p className="muted">{user.mutualServerIds.map((id) => servers[id]?.name).filter(Boolean).join(', ')}</p></>
        )}
        {!isMe && <>
          <h4>Nota</h4>
          <textarea className="note-input" rows={2} maxLength={256} placeholder="Clique para adicionar uma nota (só você vê)" value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { if (note !== (user.note ?? '')) void api(`/users/${userId}/note`, { method: 'PUT', body: { note } }).then(() => setUser({ ...user, note })); }} />
        </>}
        <h4>Membro do Nexo desde</h4><p className="muted">{new Date((user as any).createdAt).toLocaleDateString('pt-BR')}</p>
        {!isMe && (
          <div className="row gap">
            <button className="btn primary" onClick={message}>Enviar mensagem</button>
            {!relationship && <button className="btn" onClick={() => api(`/relationships/${userId}`, { method: 'PUT' })}>Adicionar amigo</button>}
            {relationship?.type === 'incoming' && <button className="btn" onClick={() => api(`/relationships/${userId}`, { method: 'PUT' })}>Aceitar pedido</button>}
            {relationship?.type === 'outgoing' && <button className="btn" disabled>Pedido enviado</button>}
            {relationship?.type !== 'blocked'
              ? <button className="btn ghost danger" onClick={() => api(`/relationships/${userId}/block`, { method: 'POST' })}>Bloquear</button>
              : <button className="btn ghost" onClick={() => api(`/relationships/${userId}`, { method: 'DELETE' })}>Desbloquear</button>}
          </div>
        )}
      </div>
    </div>
  );
}
