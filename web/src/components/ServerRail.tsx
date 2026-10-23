import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, ListOrdered, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, set, get, dmName, removeServer } from '../lib/store';
import { api, assetUrl } from '../lib/api';
import { closeModal, Dialog, openModal } from './Modal';
import { AddServerModal } from './modals/ServerModals';
import { Avatar } from './Avatar';
import { openMenu, ServerMenu } from './ContextMenu';
import { GroupIcon } from './modals/GroupSettings';
import { LogoGlyph } from './Logo';

export function ServerRail() {
  const servers = useStore(useShallow((s) => s.serverOrder.map((id) => s.servers[id]).filter(Boolean)));
  const view = useStore((s) => s.view);
  const readStates = useStore((s) => s.readStates);
  const dms = useStore((s) => s.dms);
  const pending = useStore((s) => s.relationships.filter((r) => r.type === 'incoming').length);
  const me = useStore((s) => s.me);
  // DMs with unread messages show up under the home button, newest first, like a shortcut.
  const unreadDms = Object.values(dms)
    .filter((d) => (readStates[d.id]?.mentions ?? 0) > 0)
    .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));

  return (
    <nav className="rail" aria-label="Servidores">
      <RailItem className="home" active={view.kind === 'home'} label="Mensagens diretas" badge={pending} onClick={() => set({ view: { kind: 'home' }, openThreadId: null })}>
        <LogoGlyph size={32} />
      </RailItem>
      {unreadDms.map((dm) => {
        const other = dm.type === 'dm' ? dm.recipients?.find((u) => u.id !== me?.id) : undefined;
        const name = dmName(dm, me?.id);
        return (
          <RailItem key={dm.id} label={name} badge={readStates[dm.id]?.mentions} className="rail-dm"
            onClick={() => set({ view: { kind: 'home', dmId: dm.id }, openThreadId: null })}>
            {other ? <Avatar user={other} size={48} /> : <GroupIcon channel={dm} size={48} />}
          </RailItem>
        );
      })}
      <div className="rail-sep" />
      {servers.map((srv) => {
        const channelIds = srv.channels.map((c) => c.id);
        const unread = channelIds.some((id) => readStates[id]?.unread);
        const mentions = channelIds.reduce((n, id) => n + (readStates[id]?.mentions ?? 0), 0);
        return (
          <RailItem key={srv.id} label={srv.name} active={view.kind === 'server' && view.serverId === srv.id} unread={unread} badge={mentions}
            onContextMenu={(e) => openMenu(e, <ServerMenu server={srv} />)}
            onClick={() => set({ view: { kind: 'server', serverId: srv.id }, openThreadId: null })}>
            {srv.iconUrl ? <img src={assetUrl(srv.iconUrl)} alt="" /> : <span>{initials(srv.name)}</span>}
          </RailItem>
        );
      })}
      <RailItem label="Adicionar um servidor" onClick={() => openModal(<AddServerModal />)} className="add">
        <Plus size={24} />
      </RailItem>
      {servers.length > 1 && (
        <RailItem label="Editar servidores (organizar e sair)" onClick={() => openModal(<EditServersModal />)} className="add">
          <ListOrdered size={22} />
        </RailItem>
      )}
    </nav>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3);
}

function RailItem({ children, label, active, unread, badge, onClick, onContextMenu, className = '' }: {
  children: React.ReactNode; label: string; active?: boolean; unread?: boolean; badge?: number; onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void; className?: string;
}) {
  return (
    <div className={`rail-item ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${className}`}>
      <span className="pill" />
      <button className="rail-btn" onClick={onClick} onContextMenu={onContextMenu} title={label} aria-label={label}>{children}</button>
      {!!badge && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </div>
  );
}

/** Reorder the rail (drag or arrows) and leave several servers at once. */
function EditServersModal() {
  const me = useStore((s) => s.me)!;
  const servers = useStore((s) => s.servers);
  const [order, setOrder] = useState(() => get().serverOrder.filter((id) => servers[id]));
  const [leave, setLeave] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaving = order.filter((id) => leave[id]);

  const move = (from: number, to: number) => setOrder((o) => {
    if (to < 0 || to >= o.length) return o;
    const next = [...o];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  async function save() {
    if (leaving.length && !window.confirm(`Sair de ${leaving.length} servidor(es)? Você vai precisar de um convite para voltar.`)) return;
    setSaving(true);
    setError(null);
    try {
      const kept = order.filter((id) => !leave[id]);
      await api('/users/@me/server-order', { method: 'PUT', body: { serverIds: kept } });
      set((s) => ({ serverOrder: [...kept, ...s.serverOrder.filter((id) => !order.includes(id))] }));
      for (const id of leaving) {
        await api(`/servers/${id}/members/@me`, { method: 'DELETE' });
        removeServer(id);
      }
      closeModal();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Editar servidores" footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className={`btn ${leaving.length ? 'danger' : 'primary'}`} disabled={saving} onClick={save}>
        {leaving.length ? `Salvar e sair de ${leaving.length}` : 'Salvar'}
      </button>
    </>}>
      <p className="muted small">Arraste para mudar a ordem na barra lateral. Marque "Sair" nos servidores que você quer deixar.</p>
      <div className="edit-servers">
        {order.map((id, i) => {
          const srv = servers[id];
          const owner = srv.ownerId === me.id;
          return (
            <div key={id} className={`edit-server ${dragging === id ? 'dragging' : ''} ${leave[id] ? 'leaving' : ''}`} draggable
              onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { e.preventDefault(); if (dragging && dragging !== id) move(order.indexOf(dragging), i); }}>
              <GripVertical size={16} className="grip" />
              <span className="edit-server-icon">{srv.iconUrl ? <img src={assetUrl(srv.iconUrl)} alt="" /> : initials(srv.name)}</span>
              <span className="edit-server-name">{srv.name}</span>
              <button className="icon-btn small" title="Subir" disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp size={16} /></button>
              <button className="icon-btn small" title="Descer" disabled={i === order.length - 1} onClick={() => move(i, i + 1)}><ArrowDown size={16} /></button>
              <label className={`leave-check ${owner ? 'disabled' : ''}`} title={owner ? 'Você é o dono. Transfira ou apague o servidor nas configurações.' : ''}>
                <input type="checkbox" disabled={owner} checked={!!leave[id]} onChange={(e) => setLeave({ ...leave, [id]: e.target.checked })} /> Sair
              </label>
            </div>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
