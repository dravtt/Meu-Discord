import { Check, MessageCircle, Users, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useStore, set } from '../lib/store';
import { api } from '../lib/api';
import type { Channel, Relationship } from '../lib/types';
import { Avatar, STATUS_LABEL } from './Avatar';
import { openModal } from './Modal';
import { ProfileCard } from './ProfileCard';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('online');
  const relationships = useStore((s) => s.relationships);
  const presence = useStore((s) => s.presence);
  const pending = relationships.filter((r) => r.type === 'incoming' || r.type === 'outgoing');

  const list = relationships.filter((r) => {
    if (tab === 'online') return r.type === 'friend' && (presence[r.user.id]?.status ?? 'offline') !== 'offline';
    if (tab === 'all') return r.type === 'friend';
    if (tab === 'pending') return r.type === 'incoming' || r.type === 'outgoing';
    if (tab === 'blocked') return r.type === 'blocked';
    return false;
  });

  const tabs: [Tab, string][] = [['online', 'Disponível'], ['all', 'Todos'], ['pending', `Pendente${pending.length ? ` (${pending.length})` : ''}`], ['blocked', 'Bloqueado'], ['add', 'Adicionar amigo']];

  return (
    <section className="chat friends">
      <header className="chat-header">
        <span className="channel-icon"><Users size={20} /></span><h3>Amigos</h3>
        <nav className="tabs">
          {tabs.map(([id, label]) => <button key={id} className={`${tab === id ? 'active' : ''} ${id === 'add' ? 'add' : ''}`} onClick={() => setTab(id)}>{label}</button>)}
        </nav>
      </header>
      <div className="friends-body">
        {tab === 'add' ? <AddFriend /> : (
          <>
            <div className="section-title"><span>{tabs.find(([id]) => id === tab)![1]} — {list.length}</span></div>
            {list.length === 0 && <p className="muted pad">Ninguém por aqui ainda.</p>}
            {list.map((r) => <FriendRow key={r.user.id} r={r} />)}
          </>
        )}
      </div>
    </section>
  );
}

function FriendRow({ r }: { r: Relationship }) {
  const presence = useStore((s) => s.presence[r.user.id]);
  async function message() {
    const dm = await api<Channel>('/dms', { body: { userIds: [r.user.id] } });
    set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id } }));
  }
  return (
    <div className="friend-row">
      <button className="friend-info" onClick={() => openModal(<ProfileCard userId={r.user.id} serverId={null} />)}>
        <Avatar user={r.user} size={36} showStatus />
        <span><strong>{r.user.displayName}</strong> <small className="muted">{r.user.username}</small><br />
          <small className="muted">{r.type === 'incoming' ? 'Pedido de amizade recebido' : r.type === 'outgoing' ? 'Pedido de amizade enviado' : r.type === 'blocked' ? 'Bloqueado' : presence?.customStatus || STATUS_LABEL[presence?.status ?? 'offline']}</small></span>
      </button>
      <div className="row gap">
        {r.type === 'friend' && <button className="icon-btn" title="Mensagem" onClick={message}><MessageCircle size={18} /></button>}
        {r.type === 'incoming' && <button className="icon-btn ok" title="Aceitar" onClick={() => api(`/relationships/${r.user.id}`, { method: 'PUT' })}><Check size={18} /></button>}
        <button className="icon-btn danger" title={r.type === 'friend' ? 'Remover amigo' : r.type === 'blocked' ? 'Desbloquear' : 'Recusar'} onClick={() => api(`/relationships/${r.user.id}`, { method: 'DELETE' })}><X size={18} /></button>
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const rels = await api<Relationship[]>('/relationships', { body: { username } });
      set({ relationships: rels });
      setResult({ ok: true, text: `Pedido enviado para ${username}!` });
      setUsername('');
    } catch (err) { setResult({ ok: false, text: (err as Error).message }); }
  }
  return (
    <form className="add-friend" onSubmit={submit}>
      <h3>Adicionar amigo</h3>
      <p className="muted">Você pode adicionar amigos pelo nome de usuário.</p>
      <div className="add-friend-box">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Digite um nome de usuário" autoFocus />
        <button className="btn primary" disabled={!username.trim()}>Enviar pedido de amizade</button>
      </div>
      {result && <p className={result.ok ? 'ok' : 'error'}>{result.text}</p>}
    </form>
  );
}
