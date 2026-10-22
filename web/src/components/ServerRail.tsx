import { useShallow } from 'zustand/react/shallow';
import { useStore, set } from '../lib/store';
import { assetUrl } from '../lib/api';
import { openModal } from './Modal';
import { AddServerModal } from './modals/ServerModals';

export function ServerRail() {
  const servers = useStore(useShallow((s) => s.serverOrder.map((id) => s.servers[id]).filter(Boolean)));
  const view = useStore((s) => s.view);
  const readStates = useStore((s) => s.readStates);
  const dms = useStore((s) => s.dms);
  const pending = useStore((s) => s.relationships.filter((r) => r.type === 'incoming').length);
  const dmMentions = Object.values(dms).reduce((n, d) => n + (readStates[d.id]?.mentions ?? 0), 0);

  return (
    <nav className="rail" aria-label="Servidores">
      <RailItem active={view.kind === 'home'} label="Mensagens diretas" badge={dmMentions + pending} onClick={() => set({ view: { kind: 'home' }, openThreadId: null })}>
        <span className="home-icon">N</span>
      </RailItem>
      <div className="rail-sep" />
      {servers.map((srv) => {
        const channelIds = srv.channels.map((c) => c.id);
        const unread = channelIds.some((id) => readStates[id]?.unread);
        const mentions = channelIds.reduce((n, id) => n + (readStates[id]?.mentions ?? 0), 0);
        return (
          <RailItem key={srv.id} label={srv.name} active={view.kind === 'server' && view.serverId === srv.id} unread={unread} badge={mentions}
            onClick={() => set({ view: { kind: 'server', serverId: srv.id }, openThreadId: null })}>
            {srv.iconUrl ? <img src={assetUrl(srv.iconUrl)} alt="" /> : <span>{initials(srv.name)}</span>}
          </RailItem>
        );
      })}
      <RailItem label="Adicionar um servidor" onClick={() => openModal(<AddServerModal />)} className="add">
        <span>+</span>
      </RailItem>
    </nav>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3);
}

function RailItem({ children, label, active, unread, badge, onClick, className = '' }: {
  children: React.ReactNode; label: string; active?: boolean; unread?: boolean; badge?: number; onClick: () => void; className?: string;
}) {
  return (
    <div className={`rail-item ${active ? 'active' : ''} ${unread ? 'unread' : ''} ${className}`}>
      <span className="pill" />
      <button className="rail-btn" onClick={onClick} title={label} aria-label={label}>{children}</button>
      {!!badge && <span className="badge">{badge > 99 ? '99+' : badge}</span>}
    </div>
  );
}
