import { Link, Sparkles, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
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
  try {
    const invite = await api<Invite>(`/invites/${match[1]}`);
    openModal(
      <Dialog title="Você foi convidado!" footer={<><button className="btn ghost" onClick={closeModal}>Agora não</button><button className="btn primary" onClick={async () => { await joinInvite(invite.code); closeModal(); }}>Aceitar convite</button></>}>
        <p><strong>{invite.inviter.displayName}</strong> convidou você para <strong>{invite.server.name}</strong> ({invite.server.memberCount} membros).</p>
      </Dialog>,
    );
  } catch {
    openModal(<Dialog title="Convite inválido"><p>Este convite expirou ou não existe.</p></Dialog>);
  }
}

export const inviteLink = (code: string) => `${location.origin}${location.pathname}#/convite/${code}`;

export function InviteModal({ serverId }: { serverId: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [maxAge, setMaxAge] = useState(7 * 86400);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const server = useStore((s) => s.servers[serverId]);

  useEffect(() => {
    api<Invite>(`/servers/${serverId}/invites`, { body: { maxAgeSeconds: maxAge, maxUses } }).then(setInvite).catch(() => {});
  }, [serverId, maxAge, maxUses]);

  const link = invite ? inviteLink(invite.code) : '';
  return (
    <Dialog title={`Convidar amigos para ${server?.name ?? ''}`}>
      <label>Link do convite
        <div className="row gap">
          <input readOnly value={link} onFocus={(e) => e.target.select()} />
          <button className="btn primary" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true); }}>{copied ? 'Copiado' : 'Copiar'}</button>
        </div>
      </label>
      <p className="muted small">Código: <code>{invite?.code}</code></p>
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
