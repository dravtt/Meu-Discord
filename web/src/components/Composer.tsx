import { useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { useStore, set, get, addMessage, memberName } from '../lib/store';
import { api } from '../lib/api';
import type { Channel, Message, User } from '../lib/types';
import { emitTyping } from './Chat';
import { EmojiPicker } from './EmojiPicker';
import { Avatar } from './Avatar';

const MAX_FILES = 10;

export function Composer({ channel, canAttach, placeholder }: { channel: Channel; canAttach: boolean; placeholder: string }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** Display text "@Ana" -> user id, converted to <@id> on send. */
  const mentionMap = useRef(new Map<string, string>());
  const lastTyping = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replyTo = useStore((s) => s.replyTo[channel.id] ?? null);

  const candidates = mentionQuery === null ? [] : mentionCandidates(channel, mentionQuery);

  function onChange(value: string) {
    setText(value);
    setError(null);
    const caret = input.current?.selectionStart ?? value.length;
    const match = /(^|\s)@([\p{L}\p{N}_.]*)$/u.exec(value.slice(0, caret));
    setMentionQuery(match ? match[2] : null);
    setMentionIndex(0);
    if (value && Date.now() - lastTyping.current > 6000) {
      lastTyping.current = Date.now();
      emitTyping(channel.id);
    }
  }

  function pickMention(user: User | 'everyone') {
    const el = input.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}_.]*)$/u, '');
    const label = user === 'everyone' ? '@everyone' : `@${memberName(channel.serverId, user)}`;
    if (user !== 'everyone') mentionMap.current.set(label, user.id);
    const next = `${before}${label} ${text.slice(caret)}`;
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = before.length + label.length + 1; });
  }

  async function send() {
    let content = text.trim();
    if (!content && files.length === 0) return;
    // Longest labels first so "@Ana Paula" wins over "@Ana".
    for (const [label, id] of [...mentionMap.current].sort((a, b) => b[0].length - a[0].length)) content = content.split(label).join(`<@${id}>`);
    const me = get().me!;
    const optimistic: Message = {
      id: `pending-${Date.now()}`, channelId: channel.id, author: me, content, createdAt: new Date().toISOString(), editedAt: null,
      pinned: false, threadId: null, mentionEveryone: false, mentions: [], attachments: [], reactions: [], replyTo: null, pending: true,
    };
    const form = new FormData();
    form.append('content', content);
    if (replyTo) form.append('replyToId', replyTo.id);
    for (const f of files) form.append('files', f);
    setText('');
    setFiles([]);
    mentionMap.current.clear();
    lastTyping.current = 0;
    set((s) => ({ replyTo: { ...s.replyTo, [channel.id]: null } }));
    if (files.length === 0) addMessage(optimistic);
    try {
      const saved = await api<Message>(`/channels/${channel.id}/messages`, { form });
      addMessage(saved);
    } catch (err) {
      setError((err as Error).message);
      set((s) => ({ messages: { ...s.messages, [channel.id]: (s.messages[channel.id] ?? []).filter((m) => m.id !== optimistic.id) } }));
      setText(content);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (candidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => (i + 1) % candidates.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(candidates[mentionIndex]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
    if (e.key === 'Escape' && replyTo) set((s) => ({ replyTo: { ...s.replyTo, [channel.id]: null } }));
    if (e.key === 'ArrowUp' && !text) {
      const mine = [...(get().messages[channel.id] ?? [])].reverse().find((m) => m.author.id === get().me?.id && !m.pending);
      if (mine) { e.preventDefault(); set({ editing: mine.id }); }
    }
  }

  function addFiles(list: FileList | File[]) {
    if (!canAttach) return setError('Você não pode enviar arquivos aqui');
    const tooBig = [...list].find((f) => f.size > 25 * 1024 * 1024);
    if (tooBig) return setError(`${tooBig.name} passa de 25 MB`);
    setFiles((prev) => [...prev, ...list].slice(0, MAX_FILES));
  }

  const onPaste = (e: ClipboardEvent) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } };
  const onDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

  return (
    <div className="composer-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {candidates.length > 0 && (
        <div className="autocomplete">
          {candidates.map((c, i) => (
            <button key={c === 'everyone' ? 'everyone' : c.id} className={i === mentionIndex ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); pickMention(c); }}>
              {c === 'everyone' ? <><span className="avatar-fallback tiny">@</span> @everyone <small>notifica todos</small></> :
                <><Avatar user={c} size={24} /> {memberName(channel.serverId, c)} <small>{c.username}</small></>}
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          Respondendo a <strong>{memberName(channel.serverId, replyTo.author)}</strong>
          <button className="icon-btn small" onClick={() => set((s) => ({ replyTo: { ...s.replyTo, [channel.id]: null } }))}>✕</button>
        </div>
      )}
      {files.length > 0 && (
        <div className="file-tray">
          {files.map((f, i) => (
            <div key={i} className="file-chip">
              {f.type.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt="" /> : <span>📄</span>}
              <small>{f.name}</small>
              <button className="icon-btn small" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="composer-error">{error}</div>}
      <div className="composer">
        {canAttach && <button className="icon-btn" title="Enviar arquivo" onClick={() => fileInput.current?.click()}>＋</button>}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <textarea ref={input} rows={1} value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} maxLength={4000} />
        <div className="picker-anchor">
          <button className="icon-btn" title="Emoji" onClick={() => setPicker(!picker)}>😊</button>
          {picker && <EmojiPicker onPick={(e) => { setText((t) => t + e); input.current?.focus(); }} onClose={() => setPicker(false)} up />}
        </div>
      </div>
    </div>
  );
}

function mentionCandidates(channel: Channel, query: string): (User | 'everyone')[] {
  const s = get();
  const q = query.toLowerCase();
  const users: User[] = channel.serverId
    ? (s.servers[channel.serverId]?.members ?? []).map((m) => m.user)
    : channel.recipients ?? [];
  const matches = users
    .filter((u) => u.username.includes(q) || u.displayName.toLowerCase().includes(q) || memberName(channel.serverId, u).toLowerCase().includes(q))
    .slice(0, 8);
  const list: (User | 'everyone')[] = [...matches];
  if (channel.serverId && 'everyone'.startsWith(q)) list.push('everyone');
  return list;
}
