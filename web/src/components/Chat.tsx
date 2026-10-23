import { AtSign, FileText, Hash, MessagesSquare, Pencil, Phone, Pin, Reply, SmilePlus, Trash2, Users, X, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, set, get, dmName, memberName, memberColor, findChannel } from '../lib/store';
import { api, assetUrl } from '../lib/api';
import { has, P } from '../lib/permissions';
import { renderContent } from '../lib/markdown';
import { socket } from '../lib/socket';
import { joinCall, useCall } from '../lib/voice';
import { openChannel } from '../App';
import type { Channel, Message } from '../lib/types';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { EmojiPicker } from './EmojiPicker';
import { openModal, confirmDialog, Dialog, closeModal } from './Modal';
import { ProfileCard } from './ProfileCard';
import { userMenuProps } from './ContextMenu';
import { NewGroupModal } from './modals/NewGroupModal';

const EMPTY: Message[] = [];

export function Chat({ channel, isThread, onClose }: { channel: Channel; isThread?: boolean; onClose?: () => void }) {
  const messages = useStore((s) => s.messages[channel.id] ?? EMPTY);
  const loaded = useStore((s) => channel.id in s.messages);
  const hasMore = useStore((s) => s.hasMore[channel.id] ?? false);
  const me = useStore((s) => s.me);
  const showMembers = useStore((s) => s.showMembers);
  const callChannel = useCall((s) => s.channelId);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [search, setSearch] = useState('');
  const isDm = channel.type === 'dm' || channel.type === 'group_dm';
  const perms = isDm ? P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_HISTORY | P.ADD_REACTIONS | P.ATTACH_FILES | P.CONNECT : (channel.permissions ?? findChannel(channel.parentId ?? '')?.permissions);

  // Load history and mark as read when opening a channel.
  useEffect(() => {
    stickToBottom.current = true;
    if (!get().messages[channel.id]) {
      api<Message[]>(`/channels/${channel.id}/messages?limit=50`).then((list) => {
        set((s) => ({ messages: { ...s.messages, [channel.id]: list }, hasMore: { ...s.hasMore, [channel.id]: list.length === 50 } }));
      }).catch(() => set((s) => ({ messages: { ...s.messages, [channel.id]: [] } })));
    }
    void api(`/channels/${channel.id}/ack`, { method: 'POST' }).catch(() => {});
    set((s) => ({ readStates: { ...s.readStates, [channel.id]: { channelId: channel.id, unread: false, mentions: 0 } } }));
  }, [channel.id]);

  // Re-ack when the window regains focus on this channel.
  useEffect(() => {
    const onFocus = () => {
      if (get().readStates[channel.id]?.unread) {
        void api(`/channels/${channel.id}/ack`, { method: 'POST' }).catch(() => {});
        set((s) => ({ readStates: { ...s.readStates, [channel.id]: { channelId: channel.id, unread: false, mentions: 0 } } }));
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [channel.id]);

  // A newly arrived message always brings the conversation to the bottom; loading older history does not.
  const lastId = messages.length ? messages[messages.length - 1].id : null;
  const seenLast = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (lastId !== seenLast.current) { stickToBottom.current = true; seenLast.current = lastId; }
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loaded, lastId]);

  // Images and embeds grow after they load; keep the bottom in view while that happens.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onLoad = () => { if (stickToBottom.current) el.scrollTop = el.scrollHeight; };
    el.addEventListener('load', onLoad, true);
    el.addEventListener('loadedmetadata', onLoad, true);
    return () => { el.removeEventListener('load', onLoad, true); el.removeEventListener('loadedmetadata', onLoad, true); };
  }, []);

  const loadOlder = useCallback(async () => {
    const list = get().messages[channel.id];
    if (!list?.length || !get().hasMore[channel.id]) return;
    const el = scroller.current!;
    const prevHeight = el.scrollHeight;
    const older = await api<Message[]>(`/channels/${channel.id}/messages?limit=50&before=${list[0].id}`);
    set((s) => ({ messages: { ...s.messages, [channel.id]: [...older, ...(s.messages[channel.id] ?? [])] }, hasMore: { ...s.hasMore, [channel.id]: older.length === 50 } }));
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - prevHeight; });
  }, [channel.id]);

  const onScroll = () => {
    const el = scroller.current!;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 100) void loadOlder();
  };

  const title = isDm ? dmName(channel, me?.id) : channel.name;
  const icon = isThread ? <MessagesSquare size={20} /> : isDm ? <AtSign size={20} /> : <Hash size={20} />;

  return (
    <section className="chat">
      <header className="chat-header">
        <span className="channel-icon">{icon}</span>
        <h3>{title}</h3>
        {channel.topic && <span className="topic" title={channel.topic}>{channel.topic}</span>}
        <div className="header-actions">
          {isDm && callChannel !== channel.id && <button className="icon-btn" title="Iniciar chamada" onClick={() => joinCall(channel.id)}><Phone size={20} /></button>}
          {isDm && <button className="icon-btn" title={channel.type === 'group_dm' ? 'Adicionar amigos ao grupo' : 'Criar grupo com essa pessoa'} onClick={() => openModal(<NewGroupModal from={channel} />)}><UserPlus size={20} /></button>}
          {!isThread && <button className="icon-btn" title="Mensagens fixadas" onClick={() => openModal(<PinsModal channel={channel} />)}><Pin size={20} /></button>}
          {!isThread && !isDm && <button className="icon-btn" title="Tópicos" onClick={() => openModal(<ThreadsModal channel={channel} />)}><MessagesSquare size={20} /></button>}
          {!isThread && !isDm && <button className={`icon-btn ${showMembers ? 'on' : ''}`} title="Lista de membros" onClick={() => set({ showMembers: !showMembers })}><Users size={20} /></button>}
          {!isThread && !isDm && channel.serverId && (
            <form onSubmit={(e) => { e.preventDefault(); if (search.trim()) openModal(<SearchModal serverId={channel.serverId!} query={search.trim()} />); }}>
              <input className="search" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} />
            </form>
          )}
          {onClose && <button className="icon-btn" title="Fechar" onClick={onClose}><X size={20} /></button>}
        </div>
      </header>
      <div className="messages" ref={scroller} onScroll={onScroll}>
        {loaded && !hasMore && (
          <div className="channel-start">
            <div className="start-icon">{icon}</div>
            <h2>{isDm ? title : `Bem-vindo a ${isThread ? "" : "#"}${title}!`}</h2>
            <p className="muted">{isDm ? 'Este é o começo da sua conversa.' : 'Este é o começo deste canal.'}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageItem key={m.id} message={m} prev={messages[i - 1]} channel={channel} perms={perms ?? 0} />
        ))}
      </div>
      <TypingIndicator channel={channel} />
      {has(perms, P.SEND_MESSAGES)
        ? <Composer channel={channel} canAttach={has(perms, P.ATTACH_FILES)} placeholder={`Conversar em ${isDm ? "@" : isThread ? "" : "#"}${title}`} />
        : <div className="composer disabled">Você não tem permissão para enviar mensagens aqui.</div>}
    </section>
  );
}

function sameGroup(a: Message | undefined, b: Message) {
  return !!a && a.author.id === b.author.id && !b.replyTo && new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() < 5 * 60_000;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Hoje às ${time}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Ontem às ${time}`;
  return `${d.toLocaleDateString('pt-BR')} ${time}`;
}

function MessageItem({ message: m, prev, channel, perms }: { message: Message; prev?: Message; channel: Channel; perms: number }) {
  const me = useStore((s) => s.me);
  const editing = useStore((s) => s.editing === m.id);
  const [picker, setPicker] = useState(false);
  const serverId = channel.serverId;
  const grouped = sameGroup(prev, m);
  const isMine = m.author.id === me?.id;
  const isDm = !serverId;
  const mentioned = !!me && (m.mentions.includes(me.id) || m.mentionEveryone);
  const showDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
  const canManage = has(perms, P.MANAGE_MESSAGES);

  const react = (emoji: string) => {
    const mine = m.reactions.find((r) => r.emoji === emoji)?.me;
    void api(`/channels/${channel.id}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`, { method: mine ? 'DELETE' : 'PUT' });
  };

  return (
    <>
      {showDay && <div className="day-divider"><span>{new Date(m.createdAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>}
      <article className={`message ${grouped && !showDay ? 'grouped' : ''} ${mentioned ? 'mentioned' : ''} ${m.pending ? 'pending' : ''}`}>
        {m.replyTo && (
          <div className="reply-ref" onClick={() => document.getElementById(`msg-${m.replyTo!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            ↱ {m.replyTo.deleted ? <em>Mensagem original apagada</em> : <><strong>@{m.replyTo.authorName}</strong> {renderContent((m.replyTo.content ?? '').replace(/\n/g, ' '), serverId)}</>}
          </div>
        )}
        <div className="message-row" id={`msg-${m.id}`}>
          {grouped && !showDay
            ? <span className="hover-time">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            : <button className="avatar-btn" {...userMenuProps(m.author.id, serverId)} onClick={() => openModal(<ProfileCard userId={m.author.id} serverId={serverId} />)}><Avatar user={m.author} size={40} /></button>}
          <div className="message-body">
            {(!grouped || showDay) && (
              <div className="message-meta">
                <button className="author" style={{ color: memberColor(serverId, m.author.id) }} {...userMenuProps(m.author.id, serverId)} onClick={() => openModal(<ProfileCard userId={m.author.id} serverId={serverId} />)}>
                  {memberName(serverId, m.author)}
                </button>
                <time>{formatTime(m.createdAt)}</time>
              </div>
            )}
            {editing ? <EditBox message={m} /> : (
              <div className="content">
                {renderContent(m.content, serverId, openChannel)}
                {m.editedAt && <span className="edited">(editado)</span>}
                {m.pinned && <span className="edited pinned-flag" title="Fixada"><Pin size={12} /></span>}
              </div>
            )}
            {m.attachments.map((a) => <AttachmentView key={a.id} a={a} />)}
            {m.threadId && <ThreadLink threadId={m.threadId} />}
            {m.reactions.length > 0 && (
              <div className="reactions">
                {m.reactions.map((r) => (
                  <button key={r.emoji} className={`reaction ${r.me ? 'me' : ''}`} onClick={() => react(r.emoji)} disabled={!has(perms, P.ADD_REACTIONS) && !r.me}>
                    {r.emoji} <span>{r.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {!m.pending && (
            <div className="message-actions">
              {has(perms, P.ADD_REACTIONS) && <button title="Reagir" onClick={() => setPicker(!picker)}><SmilePlus size={18} /></button>}
              {has(perms, P.SEND_MESSAGES) && <button title="Responder" onClick={() => set((s) => ({ replyTo: { ...s.replyTo, [channel.id]: m } }))}><Reply size={18} /></button>}
              {channel.type === 'text' && !m.threadId && has(perms, P.CREATE_THREADS) && <button title="Criar tópico" onClick={() => openModal(<NewThreadModal channel={channel} message={m} />)}><MessagesSquare size={18} /></button>}
              {(isDm || canManage) && <button title={m.pinned ? 'Desafixar' : 'Fixar'} onClick={() => api(`/channels/${channel.id}/pins/${m.id}`, { method: m.pinned ? 'DELETE' : 'PUT' })}><Pin size={18} /></button>}
              {isMine && <button title="Editar" onClick={() => set({ editing: m.id })}><Pencil size={18} /></button>}
              {(isMine || canManage) && <button title="Apagar" className="danger" onClick={(e) => {
                const del = () => api(`/channels/${channel.id}/messages/${m.id}`, { method: 'DELETE' });
                if (e.shiftKey) void del(); else confirmDialog('Apagar mensagem', 'Tem certeza que quer apagar esta mensagem?', 'Apagar', del);
              }}><Trash2 size={18} /></button>}
              {picker && <EmojiPicker onPick={(e) => { react(e); setPicker(false); }} onClose={() => setPicker(false)} />}
            </div>
          )}
        </div>
      </article>
    </>
  );
}

function AttachmentView({ a }: { a: Message['attachments'][number] }) {
  const url = assetUrl(a.url);
  if (a.contentType.startsWith('image/')) return <a href={url} target="_blank" rel="noreferrer"><img className="attachment-img" src={url} alt={a.filename} /></a>;
  if (a.contentType.startsWith('video/')) return <video className="attachment-img" src={url} controls />;
  if (a.contentType.startsWith('audio/')) return <audio src={url} controls />;
  return (
    <a className="attachment-file" href={url} target="_blank" rel="noreferrer" download={a.filename}>
      <FileText size={28} /><span><strong>{a.filename}</strong><small>{(a.size / 1024).toFixed(1)} KB</small></span>
    </a>
  );
}

function ThreadLink({ threadId }: { threadId: string }) {
  const thread = useStore((s) => s.threads[threadId]);
  useEffect(() => {
    if (!thread) api<Channel>(`/channels/${threadId}`).then((t) => set((s) => ({ threads: { ...s.threads, [t.id]: t } }))).catch(() => {});
  }, [threadId, thread]);
  return <button className="thread-link" onClick={() => set({ openThreadId: threadId })}><MessagesSquare size={14} /> {thread?.name ?? 'Tópico'} ›</button>;
}

function EditBox({ message }: { message: Message }) {
  const [value, setValue] = useState(message.content);
  const save = async () => {
    if (value.trim() && value.trim() !== message.content) await api(`/channels/${message.channelId}/messages/${message.id}`, { method: 'PATCH', body: { content: value } });
    set({ editing: null });
  };
  return (
    <div className="edit-box">
      <textarea value={value} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
        if (e.key === 'Escape') set({ editing: null });
      }} />
      <small className="muted">Esc para cancelar • Enter para salvar</small>
    </div>
  );
}

function TypingIndicator({ channel }: { channel: Channel }) {
  const typing = useStore((s) => s.typing[channel.id]);
  const me = useStore((s) => s.me);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(t); }, []);
  const now = Date.now();
  const ids = Object.entries(typing ?? {}).filter(([id, until]) => until > now && id !== me?.id).map(([id]) => id);
  const s = get();
  const names = ids.map((id) => {
    const user = s.servers[channel.serverId ?? '']?.members.find((m) => m.user.id === id)?.user ?? channel.recipients?.find((u) => u.id === id);
    return user ? memberName(channel.serverId, user) : 'Alguém';
  });
  return (
    <div className="typing">
      {names.length > 0 && <><span className="dots"><i /><i /><i /></span> <strong>{names.slice(0, 3).join(', ')}</strong> {names.length > 1 ? 'estão digitando…' : 'está digitando…'}</>}
    </div>
  );
}

export function emitTyping(channelId: string) {
  socket?.emit('typing', { channelId });
}

function PinsModal({ channel }: { channel: Channel }) {
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => { api<Message[]>(`/channels/${channel.id}/pins`).then(setPins).catch(() => setPins([])); }, [channel.id]);
  return (
    <Dialog title="Mensagens fixadas" wide>
      {!pins ? <p className="muted">Carregando…</p> : pins.length === 0 ? <p className="muted">Nenhuma mensagem fixada ainda.</p> :
        pins.map((m) => <MessagePreview key={m.id} m={m} serverId={channel.serverId} />)}
    </Dialog>
  );
}

function SearchModal({ serverId, query }: { serverId: string; query: string }) {
  const [results, setResults] = useState<Message[] | null>(null);
  useEffect(() => { api<Message[]>(`/servers/${serverId}/messages/search?q=${encodeURIComponent(query)}`).then(setResults).catch(() => setResults([])); }, [serverId, query]);
  return (
    <Dialog title={`Resultados para "${query}"`} wide>
      {!results ? <p className="muted">Buscando…</p> : results.length === 0 ? <p className="muted">Nada encontrado.</p> :
        results.map((m) => (
          <button key={m.id} className="search-result" onClick={() => { closeModal(); openChannel(m.channelId); }}>
            <small className="muted">#{findChannel(m.channelId)?.name}</small>
            <MessagePreview m={m} serverId={serverId} />
          </button>
        ))}
    </Dialog>
  );
}

function MessagePreview({ m, serverId }: { m: Message; serverId: string | null }) {
  return (
    <div className="message-preview">
      <Avatar user={m.author} size={32} />
      <div>
        <div className="message-meta"><strong>{memberName(serverId, m.author)}</strong><time>{formatTime(m.createdAt)}</time></div>
        <div className="content">{renderContent(m.content, serverId)}</div>
      </div>
    </div>
  );
}

function ThreadsModal({ channel }: { channel: Channel }) {
  const [threads, setThreads] = useState<Channel[] | null>(null);
  useEffect(() => { api<Channel[]>(`/channels/${channel.id}/threads`).then(setThreads).catch(() => setThreads([])); }, [channel.id]);
  return (
    <Dialog title={`Tópicos em #${channel.name}`}>
      {!threads ? <p className="muted">Carregando…</p> : threads.length === 0 ? <p className="muted">Nenhum tópico ainda. Passe o mouse em uma mensagem e clique no ícone de tópico.</p> :
        threads.map((t) => (
          <button key={t.id} className="list-row" onClick={() => { set((s) => ({ threads: { ...s.threads, [t.id]: t }, openThreadId: t.id })); closeModal(); }}><MessagesSquare size={16} /> {t.name}</button>
        ))}
    </Dialog>
  );
}

function NewThreadModal({ channel, message }: { channel: Channel; message: Message }) {
  const [name, setName] = useState(message.content.slice(0, 40) || 'Novo tópico');
  const create = async () => {
    const t = await api<Channel>(`/channels/${channel.id}/messages/${message.id}/threads`, { body: { name } });
    set((s) => ({ threads: { ...s.threads, [t.id]: t }, openThreadId: t.id }));
    closeModal();
  };
  return (
    <Dialog title="Criar tópico" footer={<><button className="btn ghost" onClick={closeModal}>Cancelar</button><button className="btn primary" onClick={create}>Criar</button></>}>
      <label>Nome do tópico<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus /></label>
    </Dialog>
  );
}
