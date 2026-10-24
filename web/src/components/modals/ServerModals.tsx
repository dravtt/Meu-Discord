import { Link, Sparkles, Volume2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { api, assetUrl } from '../../lib/api';
import { set, useStore, upsertServer } from '../../lib/store';
import { uploadImage } from '../../lib/upload';
import type { Invite, Server } from '../../lib/types';
import { Dialog, closeModal, openModal } from '../Modal';

export function AddServerModal() {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [name, setName] = useState(`Servidor de ${useStore.getState().me?.displayName ?? 'alguém'}`);
  const [icon, setIcon] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    try {
      const iconUrl = icon ? await uploadImage(icon) : null;
      const srv = await api<Server>('/servers', { body: { name, iconUrl } });
      upsertServer(srv);
      set({ view: { kind: 'server', serverId: srv.id } });
      closeModal();
    } catch (e) { setError((e as Error).message); }
  }

  async function join() {
    try {
      const srv = await joinInvite(code);
      if (srv) closeModal();
    } catch (e) { setError((e as Error).message); }
  }

  if (mode === 'choose') {
    return (
      <Dialog title="Adicionar um servidor">
        <p className="muted">Seu servidor é onde você e seus amigos se encontram.</p>
        <button className="list-row big" onClick={() => setMode('create')}><Sparkles size={20} /> Criar o meu</button>
        <button className="list-row big" onClick={() => setMode('join')}><Link size={20} /> Entrar com um convite</button>
      </Dialog>
    );
  }
  if (mode === 'create') {
    return (
      <Dialog title="Criar servidor" footer={<><button className="btn ghost" onClick={() => setMode('choose')}>Voltar</button><button className="btn primary" onClick={create} disabled={name.trim().length < 2}>Criar</button></>}>
        <label>Ícone (opcional)<input type="file" accept="image/*" onChange={(e) => setIcon(e.target.files?.[0] ?? null)} /></label>
        <label>Nome do servidor<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus /></label>
        {error && <p className="error">{error}</p>}
      </Dialog>
    );
  }
  return (
    <Dialog title="Entrar em um servidor" footer={<><button className="btn ghost" onClick={() => setMode('choose')}>Voltar</button><button className="btn primary" onClick={join} disabled={!code.trim()}>Entrar</button></>}>
      <label>Link ou código do convite<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex.: aB3dE9xY ou https://…/convite/aB3dE9xY" autoFocus /></label>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}

const codeFrom = (input: string) => input.trim().split('/').filter(Boolean).pop() ?? '';

export async function joinInvite(input: string) {
  const srv = await api<Server>(`/invites/${encodeURIComponent(codeFrom(input))}`, { method: 'POST' });
  upsertServer(srv);
  set({ view: { kind: 'server', serverId: srv.id }, openThreadId: null });
  return srv;
}

/** Handles links like https://nexo.app/#/convite/CODE by showing a join prompt. */
export async function joinInviteFromUrl() {
  const match = /#\/convite\/([\w-]+)/.exec(location.hash);
  if (!match) return;
  history.replaceState(null, '', location.pathname);
  await openInvite(match[1]);
}

function InvitePrompt({ invite }: { invite: Invite }) {
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(!invite.server.nsfw);
  return (
    <Dialog title="Você foi convidado!" footer={<>
      <button className="btn ghost" onClick={closeModal}>Agora não</button>
      <button className="btn primary" disabled={!agreed} onClick={async () => {
        try { await joinInvite(invite.code); closeModal(); } catch (e) { setError((e as Error).message); }
      }}>Aceitar convite</button>
    </>}>
      <p><strong>{invite.inviter.displayName}</strong> convidou você para <strong>{invite.server.name}</strong> ({invite.server.memberCount} membros).</p>
      {invite.server.nsfw && (
        <div className="nsfw-warning">
          <strong>Servidor +18</strong>
          <p>Este servidor pode ter conteúdo adulto. Só maiores de 18 anos podem entrar.</p>
          <label className="check-row"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> Tenho 18 anos ou mais e quero entrar</label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}

/** Invite links in any message, whatever address they were copied from (localhost, a tunnel, the real site). */
export const INVITE_URL = /https?:\/\/[^\s<]+?#\/convite\/([\w-]+)/g;
export const inviteCodeOf = (url: string) => /#\/convite\/([\w-]+)/.exec(url)?.[1] ?? null;

/** Opens the join prompt here instead of following the link to another tab. */
export async function openInvite(code: string) {
  try {
    const invite = await api<Invite>(`/invites/${encodeURIComponent(code)}`);
    if (invite.joined) { set({ view: { kind: 'server', serverId: invite.server.id }, openThreadId: null }); return; }
    openModal(<InvitePrompt invite={invite} />);
  } catch {
    openModal(<Dialog title="Convite inválido"><p>Este convite expirou ou não existe.</p></Dialog>);
  }
}

export function onInviteLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  const code = inviteCodeOf(e.currentTarget.href);
  if (!code) return;
  e.preventDefault();
  void openInvite(code);
}

const isLocal = () => /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname) || location.protocol === 'file:';
let publicBase: Promise<string> | null = null;
/** Where friends can reach this Voka: this page's own address, or (on the host PC) the tunnel or PUBLIC_URL. */
const inviteBase = () => publicBase ??= (isLocal()
  ? api<{ url: string }>('/public-url').then((r) => r.url).catch(() => '')
  : Promise.resolve(''));

export const inviteLink = (code: string, base = '') => `${base || `${location.origin}${location.pathname}`}#/convite/${code}`;

/** The card shown under a message that has an invite link, with a button to join right here. */
export function InviteEmbed({ code }: { code: string }) {
  const [invite, setInvite] = useState<Invite | null | 'gone'>(null);
  const [busy, setBusy] = useState(false);
  const member = useStore((s) => (invite && invite !== 'gone' ? !!s.servers[invite.server.id] : false));
  useEffect(() => { api<Invite>(`/invites/${encodeURIComponent(code)}`).then(setInvite).catch(() => setInvite('gone')); }, [code]);
  if (!invite) return <div className="invite-embed loading"><small>Carregando convite…</small></div>;
  if (invite === 'gone') {
    return (
      <div className="invite-embed">
        <small className="invite-embed-title">Convite inválido</small>
        <div className="invite-embed-row"><div className="invite-embed-icon gone">?</div><div><strong>Este convite expirou</strong><p className="muted small">Peça um convite novo para quem te enviou.</p></div></div>
      </div>
    );
  }
  const srv = invite.server;
  const created = srv.createdAt ? new Date(srv.createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : null;
  return (
    <div className="invite-embed">
      <small className="invite-embed-title">Você recebeu um convite para entrar em um servidor</small>
      <div className="invite-embed-row">
        <div className="invite-embed-icon">{srv.iconUrl ? <img src={assetUrl(srv.iconUrl)} alt="" /> : srv.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()}</div>
        <div className="invite-embed-info">
          <strong>{srv.name}{srv.nsfw && <span className="nsfw-tag">+18</span>}</strong>
          <div className="invite-embed-counts">
            <span><i className="dot on" />{srv.onlineCount ?? 0} online</span>
            <span><i className="dot" />{srv.memberCount} {srv.memberCount === 1 ? 'membro' : 'membros'}</span>
          </div>
          {created && <small className="muted">Criado em {created}</small>}
        </div>
      </div>
      {member
        ? <button className="btn invite-embed-btn joined" onClick={() => set({ view: { kind: 'server', serverId: srv.id }, openThreadId: null })}>Ir para o servidor</button>
        : <button className="btn invite-embed-btn" disabled={busy} onClick={async () => {
            if (srv.nsfw) { openModal(<InvitePrompt invite={invite} />); return; }
            setBusy(true);
            try { await joinInvite(code); } catch (e) { openModal(<Dialog title="Não deu para entrar"><p>{(e as Error).message}</p></Dialog>); } finally { setBusy(false); }
          }}>Aceitar convite</button>}
    </div>
  );
}

export function InviteModal({ serverId }: { serverId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [maxAge, setMaxAge] = useState(7 * 86400);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const server = useStore((s) => s.servers[serverId]);

  const [base, setBase] = useState<string | null>(isLocal() ? null : '');
  useEffect(() => { void inviteBase().then(setBase); }, []);

  useEffect(() => {
    api<Invite>(`/servers/${serverId}/invites`, { body: { maxAgeSeconds: maxAge, maxUses } }).then(setInvite).catch(() => {});
  }, [serverId, maxAge, maxUses]);

  const link = invite && base !== null ? inviteLink(invite.code, base) : '';
  return (
    <Dialog title={`Convidar amigos para ${server?.name ?? ''}`}>
      <label>Link do convite
        <div className="row gap">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn primary" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? 'Copiado' : 'Copiar'}</button>
        </div>
      </label>
      <p className="muted small">Código: <code>{invite?.code}</code></p>
      {isLocal() && base === '' && (
        <p className="invite-local-warning">Este link usa <strong>localhost</strong> e só abre no seu PC. Para mandar fora do Voka (WhatsApp etc.), ligue o túnel e abra o Voka uma vez pelo link do túnel, ou coloque PUBLIC_URL no server\.env. Dentro do Voka o convite funciona de qualquer jeito.</p>
      )}
      <div className="row gap">
        <label>Expira em
          <select value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
            <option value={1800}>30 minutos</option><option value={3600}>1 hora</option><option value={86400}>1 dia</option>
            <option value={7 * 86400}>7 dias</option><option value={0}>Nunca</option>
          </select>
        </label>
        <label>Máximo de usos
          <select value={maxUses ?? 0} onChange={(e) => setMaxUses(Number(e.target.value) || null)}>
            <option value={0}>Sem limite</option><option value={1}>1 uso</option><option value={5}>5 usos</option><option value={10}>10 usos</option><option value={100}>100 usos</option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}

export function CreateChannelModal({ serverId, parentId, category }: { serverId: string; parentId?: string; category?: boolean }) {
  const server = useStore((s) => s.servers[serverId]);
  const [type, setType] = useState<'text' | 'voice'>('text');
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parentId ?? '');
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = server?.channels.filter((c) => c.type === 'category') ?? [];

  async function create() {
    try {
      await api(`/servers/${serverId}/channels`, { body: { name, type: category ? 'category' : type, parentId: category ? null : parent || null, private: isPrivate } });
      closeModal();
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <Dialog title={category ? 'Criar categoria' : 'Criar canal'} footer={<><button className="btn ghost" onClick={closeModal}>Cancelar</button><button className="btn primary" onClick={create} disabled={!name.trim()}>Criar</button></>}>
      {!category && (
        <div className="radio-cards">
          <button className={type === 'text' ? 'active' : ''} onClick={() => setType('text')}><strong># Texto</strong><small>Mensagens, imagens, opiniões e piadas</small></button>
          <button className={type === 'voice' ? 'active' : ''} onClick={() => setType('voice')}><strong><Volume2 size={16} /> Voz</strong><small>Conversem por voz, vídeo e compartilhem a tela</small></button>
        </div>
      )}
      <label>Nome<input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={category ? 'nova categoria' : 'novo-canal'} autoFocus /></label>
      {!category && (
        <label>Categoria
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label className="check"><input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} /> {category ? 'Categoria' : 'Canal'} privado (só você e cargos escolhidos podem ver)</label>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
