import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { Check, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useStore, set, get } from '../lib/store';
import { has, P } from '../lib/permissions';
import type { Channel, Invite, Server } from '../lib/types';
import { joinCall, useCall } from '../lib/voice';
import { usePrefs, savePrefs, type ServerNotify } from '../lib/prefs';
import { closeModal, confirmDialog, Dialog, openModal } from './Modal';
import { ProfileCard } from './ProfileCard';
import { inviteLink } from './modals/ServerModals';

const useMenu = create<{ x: number; y: number; content: ReactNode } | null>(() => null);

export const closeMenu = () => useMenu.setState(null, true);

/** Opens a menu at the pointer. Use from onContextMenu (or onClick for "..." buttons). */
export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, content: ReactNode) {
  e.preventDefault();
  e.stopPropagation();
  useMenu.setState({ x: e.clientX, y: e.clientY, content }, true);
}

/** Calls `onOutside` when the user presses the mouse outside `ref` (or hits Escape). */
export function useClickOutside(ref: { current: HTMLElement | null }, active: boolean, onOutside: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOutside(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [active, onOutside, ref]);
}

export function ContextMenuHost() {
  const menu = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useClickOutside(ref, !!menu, closeMenu);
  useEffect(() => {
    if (!menu) return;
    window.addEventListener('blur', closeMenu);
    window.addEventListener('resize', closeMenu);
    return () => { window.removeEventListener('blur', closeMenu); window.removeEventListener('resize', closeMenu); };
  }, [menu]);
  // Keep the menu inside the window.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(menu.x, innerWidth - r.width - 8)), y: Math.max(4, Math.min(menu.y, innerHeight - r.height - 8)) });
  }, [menu]);
  if (!menu) return null;
  return <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>{menu.content}</div>;
}

export function MenuItem({ label, onClick, danger, hint, checked }: { label: string; onClick: () => void; danger?: boolean; hint?: string; checked?: boolean }) {
  return (
    <button className={`ctx-item ${danger ? 'danger' : ''}`} role="menuitem" onClick={() => { closeMenu(); onClick(); }}>
      <span className="ctx-label">{label}{hint && <small>{hint}</small>}</span>
      {checked !== undefined && <span className={`ctx-check ${checked ? 'on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span>}
    </button>
  );
}

export function MenuToggle({ label, checked, onChange, danger }: { label: string; checked: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <button className={`ctx-item ${danger ? 'danger' : ''}`} role="menuitemcheckbox" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="ctx-label">{label}</span>
      <span className={`ctx-check ${checked ? 'on' : ''}`}>{checked && <Check size={12} strokeWidth={3} />}</span>
    </button>
  );
}

export function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open && ref.current) setLeft(ref.current.getBoundingClientRect().right + 200 > innerWidth);
  }, [open]);
  return (
    <div ref={ref} className="ctx-sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="ctx-item" onClick={() => setOpen(!open)}><span className="ctx-label">{label}</span><ChevronRight size={16} /></button>
      {open && <div className={`ctx-menu nested ${left ? 'left' : ''}`}>{children}</div>}
    </div>
  );
}

export const MenuSep = () => <div className="ctx-sep" />;

/* ---------- user menu ---------- */

async function openDm(userId: string) {
  const dm = await api<Channel>('/dms', { body: { userIds: [userId] } });
  set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id }, openThreadId: null }));
  return dm;
}

async function inviteTo(serverId: string, userId: string) {
  const invite = await api<Invite>(`/servers/${serverId}/invites`, { body: { maxAgeSeconds: 7 * 86400 } });
  const dm = await openDm(userId);
  await api(`/channels/${dm.id}/messages`, { body: { content: `Entra no meu servidor **${invite.server.name}**: ${inviteLink(invite.code)}` } });
}

function NoteModal({ userId, name }: { userId: string; name: string }) {
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { api<{ note?: string }>(`/users/${userId}`).then((u) => setNote(u.note ?? '')).catch(() => setNote('')); }, [userId]);
  return (
    <Dialog title={`Nota sobre ${name}`} footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn primary" disabled={note === null} onClick={async () => { await api(`/users/${userId}/note`, { method: 'PUT', body: { note } }); closeModal(); }}>Salvar</button>
    </>}>
      <p className="muted small">Visível apenas para você.</p>
      <textarea value={note ?? ''} maxLength={256} rows={4} placeholder="Clique para adicionar uma nota" onChange={(e) => setNote(e.target.value)} autoFocus disabled={note === null} />
    </Dialog>
  );
}

function VolumeSlider({ userId }: { userId: string }) {
  const volume = usePrefs((p) => p.userVolume[userId] ?? 100);
  return (
    <div className="ctx-slider" onClick={(e) => e.stopPropagation()}>
      <span className="ctx-label">Volume do usuário <small>{volume}%</small></span>
      <input type="range" min={0} max={200} step={5} value={volume} aria-label="Volume do usuário"
        onChange={(e) => { const v = Number(e.target.value); savePrefs((p) => ({ userVolume: { ...p.userVolume, [userId]: v } })); }} />
    </div>
  );
}

function myTopRole(server: Server, meId: string) {
  if (server.ownerId === meId) return Infinity;
  const mine = server.members.find((m) => m.user.id === meId)?.roleIds ?? [];
  return Math.max(0, ...server.roles.filter((r) => mine.includes(r.id)).map((r) => r.position));
}

function RolesSub({ server, userId }: { server: Server; userId: string }) {
  const me = useStore((s) => s.me)!;
  const live = useStore((s) => s.servers[server.id]) ?? server;
  const member = live.members.find((m) => m.user.id === userId);
  const top = myTopRole(live, me.id);
  const roles = live.roles.filter((r) => !r.isDefault && r.position < top).sort((a, b) => b.position - a.position);
  if (!member || roles.length === 0) return null;
  return (
    <SubMenu label="Cargos">
      {roles.map((r) => {
        const on = member.roleIds.includes(r.id);
        return (
          <button key={r.id} className="ctx-item" onClick={() => api(`/servers/${server.id}/members/${userId}/roles/${r.id}`, { method: on ? 'DELETE' : 'PUT' })}>
            <span className="ctx-label"><i className="role-dot" style={{ background: r.color }} />{r.name}</span>
            <span className={`ctx-check ${on ? 'on' : ''}`}>{on && <Check size={12} strokeWidth={3} />}</span>
          </button>
        );
      })}
    </SubMenu>
  );
}

/** The right-click menu for a person: profile, message, call, note, volume (in a call), invites, friends, roles. */
export function UserMenu({ userId, serverId }: { userId: string; serverId?: string | null }) {
  const me = useStore((s) => s.me)!;
  const relationship = useStore((s) => s.relationships.find((r) => r.user.id === userId));
  const servers = useStore((s) => s.servers);
  const server = serverId ? servers[serverId] : undefined;
  const callChannel = useCall((s) => s.channelId);
  const theirVoice = useStore((s) => s.voiceStates[userId]);
  const muted = usePrefs((p) => !!p.userMuted[userId]);
  const isMe = userId === me.id;
  const inCallWithThem = !isMe && !!callChannel && theirVoice?.channelId === callChannel;
  const name = findName(userId);
  const inviteTargets = Object.values(servers).filter((s) => has(s.permissions, P.CREATE_INVITE) && !s.members.some((m) => m.user.id === userId));
  const canRoles = server && has(server.permissions, P.MANAGE_ROLES);

  return (
    <>
      <MenuItem label="Perfil" onClick={() => openModal(<ProfileCard userId={userId} serverId={serverId ?? null} />)} />
      {!isMe && <MenuItem label="Mensagem" onClick={() => void openDm(userId)} />}
      {!isMe && <MenuItem label="Iniciar chamada" onClick={async () => { const dm = await openDm(userId); void joinCall(dm.id); }} />}
      {!isMe && <MenuItem label="Adicionar nota" hint="Visível apenas para você" onClick={() => openModal(<NoteModal userId={userId} name={name} />)} />}
      {inCallWithThem && <>
        <MenuSep />
        <VolumeSlider userId={userId} />
        <MenuToggle label="Silenciar" checked={muted} onChange={(v) => savePrefs((p) => ({ userMuted: { ...p.userMuted, [userId]: v } }))} />
      </>}
      {!isMe && <>
        <MenuSep />
        {inviteTargets.length > 0 && (
          <SubMenu label="Convidar para o servidor">
            {inviteTargets.map((s) => <MenuItem key={s.id} label={s.name} onClick={() => void inviteTo(s.id, userId)} />)}
          </SubMenu>
        )}
        {!relationship && <MenuItem label="Adicionar amigo" onClick={() => void api(`/relationships/${userId}`, { method: 'PUT' })} />}
        {relationship?.type === 'incoming' && <MenuItem label="Aceitar pedido de amizade" onClick={() => void api(`/relationships/${userId}`, { method: 'PUT' })} />}
        {relationship?.type === 'outgoing' && <MenuItem label="Cancelar pedido de amizade" onClick={() => void api(`/relationships/${userId}`, { method: 'DELETE' })} />}
        {relationship?.type === 'friend' && <MenuItem label="Remover amigo" danger onClick={() => confirmDialog('Remover amigo', `Remover ${name} da sua lista de amigos?`, 'Remover', async () => { await api(`/relationships/${userId}`, { method: 'DELETE' }); })} />}
        {relationship?.type === 'blocked'
          ? <MenuItem label="Desbloquear" onClick={() => void api(`/relationships/${userId}`, { method: 'DELETE' })} />
          : <MenuItem label="Bloquear" danger onClick={() => confirmDialog('Bloquear', `Bloquear ${name}? Vocês deixam de ser amigos e essa pessoa não poderá te mandar mensagens.`, 'Bloquear', async () => { await api(`/relationships/${userId}/block`, { method: 'POST' }); })} />}
      </>}
      {canRoles && <><MenuSep /><RolesSub server={server} userId={userId} /></>}
      <MenuSep />
      <MenuItem label="Copiar ID do usuário" onClick={() => void navigator.clipboard?.writeText(userId)} />
    </>
  );
}

function findName(userId: string) {
  const s = get();
  for (const srv of Object.values(s.servers)) {
    const m = srv.members.find((x) => x.user.id === userId);
    if (m) return m.user.displayName;
  }
  const r = s.relationships.find((x) => x.user.id === userId);
  if (r) return r.user.displayName;
  for (const dm of Object.values(s.dms)) {
    const u = dm.recipients?.find((x) => x.id === userId);
    if (u) return u.displayName;
  }
  return 'usuário';
}

/** Right-click handler props for anything that shows a person. */
export const userMenuProps = (userId: string, serverId?: string | null) => ({
  onContextMenu: (e: React.MouseEvent) => openMenu(e, <UserMenu userId={userId} serverId={serverId} />),
});

/* ---------- server menu ---------- */

export async function markServerRead(server: Server) {
  const rs = get().readStates;
  await Promise.all(server.channels.filter((c) => rs[c.id]?.unread).map((c) => api(`/channels/${c.id}/ack`, { method: 'POST' })));
  set((s) => {
    const readStates = { ...s.readStates };
    for (const c of server.channels) if (readStates[c.id]) readStates[c.id] = { ...readStates[c.id], unread: false, mentions: 0 };
    return { readStates };
  });
}

const NOTIFY_LABELS: [ServerNotify, string][] = [['all', 'Todas as mensagens'], ['mentions', 'Somente @menções'], ['none', 'Nada']];

export function ServerMenu({ server }: { server: Server }) {
  const me = useStore((s) => s.me)!;
  const level = usePrefs((p) => p.serverNotify[server.id] ?? 'all');
  return (
    <>
      <MenuItem label="Marcar como lida" onClick={() => void markServerRead(server)} />
      <MenuSep />
      <SubMenu label="Notificações">
        {NOTIFY_LABELS.map(([id, label]) => (
          <MenuItem key={id} label={label} checked={level === id} onClick={() => savePrefs((p) => ({ serverNotify: { ...p.serverNotify, [server.id]: id } }))} />
        ))}
      </SubMenu>
      <MenuToggle label="Silenciar servidor" checked={level === 'none'} onChange={(v) => savePrefs((p) => ({ serverNotify: { ...p.serverNotify, [server.id]: v ? 'none' : 'all' } }))} />
      {server.ownerId !== me.id && <>
        <MenuSep />
        <MenuItem label="Sair do servidor" danger onClick={() => confirmDialog('Sair do servidor', `Tem certeza que quer sair de ${server.name}?`, 'Sair', async () => { await api(`/servers/${server.id}/members/@me`, { method: 'DELETE' }); })} />
      </>}
      <MenuSep />
      <MenuItem label="Copiar ID do servidor" onClick={() => void navigator.clipboard?.writeText(server.id)} />
    </>
  );
}
