import { Check, Slash, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useStore } from '../../lib/store';
import { P } from '../../lib/permissions';
import { closeModal, confirmDialog } from '../Modal';

const CHANNEL_PERMS: [number, string][] = [
  [P.VIEW_CHANNEL, 'Ver canal'],
  [P.SEND_MESSAGES, 'Enviar mensagens'],
  [P.READ_HISTORY, 'Ler histórico'],
  [P.ADD_REACTIONS, 'Adicionar reações'],
  [P.ATTACH_FILES, 'Anexar arquivos'],
  [P.MANAGE_MESSAGES, 'Gerenciar mensagens'],
  [P.CONNECT, 'Conectar (voz)'],
  [P.SPEAK, 'Falar (voz)'],
  [P.VIDEO, 'Vídeo (voz)'],
];

export function ChannelSettings({ channelId, serverId }: { channelId: string; serverId: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const channel = server?.channels.find((c) => c.id === channelId);
  const [name, setName] = useState(channel?.name ?? '');
  const [topic, setTopic] = useState(channel?.topic ?? '');
  const [tab, setTab] = useState<'overview' | 'perms'>('overview');
  const [roleId, setRoleId] = useState(server?.roles.find((r) => r.isDefault)?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  if (!server || !channel) return null;

  const overwrite = server.overwrites.find((o) => o.channelId === channel.id && o.targetId === roleId) ?? { allow: 0, deny: 0 };
  const stateOf = (flag: number) => ((overwrite.allow & flag) ? 'allow' : (overwrite.deny & flag) ? 'deny' : 'inherit');

  async function setState(flag: number, state: 'allow' | 'deny' | 'inherit') {
    let { allow, deny } = overwrite;
    allow &= ~flag; deny &= ~flag;
    if (state === 'allow') allow |= flag;
    if (state === 'deny') deny |= flag;
    try {
      if (allow === 0 && deny === 0) await api(`/channels/${channel!.id}/overwrites/${roleId}`, { method: 'DELETE' });
      else await api(`/channels/${channel!.id}/overwrites/${roleId}`, { method: 'PUT', body: { type: 'role', allow, deny } });
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="dialog settings">
      <nav className="settings-nav">
        <small className="muted">{channel.type === 'category' ? 'Categoria' : `#${channel.name}`}</small>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Visão geral</button>
        <button className={tab === 'perms' ? 'active' : ''} onClick={() => setTab('perms')}>Permissões</button>
        <button className="danger" onClick={() => confirmDialog('Excluir canal', `Excluir "${channel.name}"? As mensagens serão perdidas.`, 'Excluir', async () => { await api(`/channels/${channel.id}`, { method: 'DELETE' }); })}>Excluir canal</button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn close" onClick={closeModal}><X size={20} /></button>
        {tab === 'overview' ? (
          <section>
            <h2>Visão geral</h2>
            <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
            {channel.type === 'text' && <label>Tópico<textarea value={topic} maxLength={1024} onChange={(e) => setTopic(e.target.value)} /></label>}
            <button className="btn primary" onClick={async () => { await api(`/channels/${channel.id}`, { method: 'PATCH', body: { name, topic } }); closeModal(); }}>Salvar</button>
          </section>
        ) : (
          <section>
            <h2>Permissões do canal</h2>
            <p className="muted small">Ajuste o que cada cargo pode fazer neste canal. "/" herda do cargo.{channel.type === 'category' && ' Canais da categoria sem permissões próprias seguem estas.'}</p>
            <label>Cargo
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {server.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {CHANNEL_PERMS.map(([flag, label]) => (
              <div key={flag} className="perm-row">
                <span>{label}</span>
                <div className="tri">
                  <button className={stateOf(flag) === 'deny' ? 'deny on' : 'deny'} onClick={() => setState(flag, 'deny')}><X size={16} /></button>
                  <button className={stateOf(flag) === 'inherit' ? 'on' : ''} onClick={() => setState(flag, 'inherit')}><Slash size={14} /></button>
                  <button className={stateOf(flag) === 'allow' ? 'allow on' : 'allow'} onClick={() => setState(flag, 'allow')}><Check size={16} /></button>
                </div>
              </div>
            ))}
            {error && <p className="error">{error}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
