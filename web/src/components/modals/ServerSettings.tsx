import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useStore, memberName } from '../../lib/store';
import { has, P, PERMISSION_LABELS } from '../../lib/permissions';
import { uploadImage } from '../../lib/upload';
import type { Invite, Role, Server, User } from '../../lib/types';
import { Avatar } from '../Avatar';
import { closeModal, confirmDialog, openModal } from '../Modal';
import { inviteLink } from './ServerModals';

type Tab = 'overview' | 'roles' | 'members' | 'invites' | 'bans';

export function ServerSettings({ serverId }: { serverId: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const me = useStore((s) => s.me);
  const [tab, setTab] = useState<Tab>('overview');
  if (!server) return null;
  const perms = server.permissions;
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Visão geral', has(perms, P.MANAGE_SERVER)],
    ['roles', 'Cargos', has(perms, P.MANAGE_ROLES)],
    ['members', 'Membros', has(perms, P.KICK_MEMBERS) || has(perms, P.MANAGE_ROLES) || has(perms, P.BAN_MEMBERS)],
    ['invites', 'Convites', has(perms, P.MANAGE_SERVER)],
    ['bans', 'Banimentos', has(perms, P.BAN_MEMBERS)],
  ];
  const visible = tabs.filter(([, , ok]) => ok);
  const current = visible.some(([t]) => t === tab) ? tab : visible[0]?.[0];

  return (
    <div className="dialog settings">
      <nav className="settings-nav">
        <small className="muted">{server.name}</small>
        {visible.map(([t, label]) => <button key={t} className={current === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>)}
        {server.ownerId === me?.id && (
          <button className="danger" onClick={() => confirmDialog('Excluir servidor', `Excluir "${server.name}" para sempre? Isso não pode ser desfeito.`, 'Excluir servidor', async () => {
            await api(`/servers/${server.id}`, { method: 'DELETE' });
          })}>Excluir servidor</button>
        )}
      </nav>
      <div className="settings-body">
        <button className="icon-btn close" onClick={closeModal}><X size={20} /></button>
        {current === 'overview' && <Overview server={server} />}
        {current === 'roles' && <Roles server={server} />}
        {current === 'members' && <Members server={server} />}
        {current === 'invites' && <Invites server={server} />}
        {current === 'bans' && <Bans server={server} />}
      </div>
    </div>
  );
}

function Overview({ server }: { server: Server }) {
  const [name, setName] = useState(server.name);
  const [saved, setSaved] = useState(false);
  const me = useStore((s) => s.me);
  return (
    <section>
      <h2>Visão geral</h2>
      <label>Nome do servidor<input value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></label>
      <label>Ícone<input type="file" accept="image/*" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (f) await api(`/servers/${server.id}`, { method: 'PATCH', body: { iconUrl: await uploadImage(f) } });
      }} /></label>
      {server.iconUrl && <button className="link" onClick={() => api(`/servers/${server.id}`, { method: 'PATCH', body: { iconUrl: null } })}>Remover ícone</button>}
      <div className="row gap"><button className="btn primary" onClick={async () => { await api(`/servers/${server.id}`, { method: 'PATCH', body: { name } }); setSaved(true); }}>Salvar</button>{saved && <span className="ok">Salvo!</span>}</div>
      <h3>Servidor +18</h3>
      <label className="check-row">
        <input type="checkbox" checked={!!server.nsfw} onChange={(e) => void api(`/servers/${server.id}`, { method: 'PATCH', body: { nsfw: e.target.checked } })} />
        Conteúdo adulto: só quem tem 18 anos ou mais consegue entrar pelo convite
      </label>
      {server.ownerId === me?.id && (
        <>
          <h3>Transferir posse</h3>
          <select defaultValue="" onChange={(e) => {
            const target = server.members.find((m) => m.user.id === e.target.value);
            if (target) confirmDialog('Transferir posse', `Tornar ${target.user.displayName} dono(a) de ${server.name}?`, 'Transferir', async () => { await api(`/servers/${server.id}/transfer`, { body: { userId: target.user.id } }); });
          }}>
            <option value="" disabled>Escolha um membro…</option>
            {server.members.filter((m) => m.user.id !== me?.id).map((m) => <option key={m.user.id} value={m.user.id}>{m.user.displayName}</option>)}
          </select>
        </>
      )}
    </section>
  );
}

function Roles({ server }: { server: Server }) {
  const [selected, setSelected] = useState<string>(server.roles[0]?.id);
  const role = server.roles.find((r) => r.id === selected) ?? server.roles[0];
  return (
    <section className="roles-layout">
      <div className="role-list">
        <div className="row between"><h2>Cargos</h2>
          <button className="btn small primary" onClick={async () => { const r = await api<Role>(`/servers/${server.id}/roles`, { body: { name: 'novo cargo' } }); setSelected(r.id); }}>Criar</button>
        </div>
        {server.roles.map((r) => (
          <button key={r.id} className={`list-row ${r.id === role?.id ? 'active' : ''}`} onClick={() => setSelected(r.id)}>
            <i className="role-dot" style={{ background: r.color }} /> {r.name}
          </button>
        ))}
      </div>
      {role && <RoleEditor key={role.id} server={server} role={role} />}
    </section>
  );
}

function RoleEditor({ server, role }: { server: Server; role: Role }) {
  const [draft, setDraft] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(role);
  const toggle = (flag: number) => setDraft({ ...draft, permissions: draft.permissions ^ flag });
  async function save() {
    try {
      await api(`/servers/${server.id}/roles/${role.id}`, { method: 'PATCH', body: role.isDefault
        ? { permissions: draft.permissions, color: draft.color }
        : { name: draft.name, color: draft.color, hoist: draft.hoist, permissions: draft.permissions } });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <div className="role-editor">
      <h3>Editar cargo — {role.name}</h3>
      {!role.isDefault && <label>Nome<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>}
      <label>Cor<input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
      {!role.isDefault && <label className="check"><input type="checkbox" checked={draft.hoist} onChange={(e) => setDraft({ ...draft, hoist: e.target.checked })} /> Mostrar membros com este cargo separadamente</label>}
      <h4>Permissões</h4>
      <div className="perm-list">
        {PERMISSION_LABELS.map(([key, label]) => (
          <label key={key} className="check"><input type="checkbox" checked={(draft.permissions & P[key]) !== 0} onChange={() => toggle(P[key])} /> {label}</label>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row gap">
        <button className="btn primary" disabled={!dirty} onClick={save}>Salvar alterações</button>
        {dirty && <button className="btn ghost" onClick={() => setDraft(role)}>Desfazer</button>}
        {!role.isDefault && <button className="btn ghost danger" onClick={() => confirmDialog('Excluir cargo', `Excluir o cargo "${role.name}"?`, 'Excluir', async () => { await api(`/servers/${server.id}/roles/${role.id}`, { method: 'DELETE' }); openModal(<ServerSettings serverId={server.id} />); })}>Excluir cargo</button>}
      </div>
    </div>
  );
}

function Members({ server }: { server: Server }) {
  const [filter, setFilter] = useState('');
  const me = useStore((s) => s.me);
  const roles = server.roles.filter((r) => !r.isDefault);
  const canRoles = has(server.permissions, P.MANAGE_ROLES);
  const members = server.members.filter((m) => `${m.user.username} ${m.user.displayName} ${m.nickname ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const act = async (fn: () => Promise<unknown>) => { await fn().catch((e) => alert(e.message)); };
  return (
    <section>
      <h2>Membros — {server.members.length}</h2>
      <input placeholder="Buscar membros" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {members.map((m) => (
        <div key={m.user.id} className="member-admin">
          <Avatar user={m.user} size={32} />
          <div className="grow">
            <strong>{memberName(server.id, m.user)}</strong> <small className="muted">{m.user.username}</small>
            <div className="role-chips">
              {roles.filter((r) => m.roleIds.includes(r.id)).map((r) => (
                <span key={r.id} className="role-chip"><i style={{ background: r.color }} />{r.name}
                  {canRoles && <button onClick={() => act(() => api(`/servers/${server.id}/members/${m.user.id}/roles/${r.id}`, { method: 'DELETE' }))}><X size={12} /></button>}
                </span>
              ))}
              {canRoles && roles.some((r) => !m.roleIds.includes(r.id)) && (
                <select value="" onChange={(e) => act(() => api(`/servers/${server.id}/members/${m.user.id}/roles/${e.target.value}`, { method: 'PUT' }))}>
                  <option value="">+ cargo</option>
                  {roles.filter((r) => !m.roleIds.includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              )}
            </div>
          </div>
          {m.user.id !== me?.id && m.user.id !== server.ownerId && (
            <div className="row gap">
              {has(server.permissions, P.KICK_MEMBERS) && <button className="btn small ghost" onClick={() => confirmDialog('Expulsar', `Expulsar ${m.user.displayName}?`, 'Expulsar', () => act(() => api(`/servers/${server.id}/members/${m.user.id}`, { method: 'DELETE' })))}>Expulsar</button>}
              {has(server.permissions, P.BAN_MEMBERS) && <button className="btn small danger" onClick={() => confirmDialog('Banir', `Banir ${m.user.displayName}? A pessoa não poderá voltar até ser desbanida.`, 'Banir', () => act(() => api(`/servers/${server.id}/bans/${m.user.id}`, { method: 'PUT', body: {} })))}>Banir</button>}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function Invites({ server }: { server: Server }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const load = () => api<Invite[]>(`/servers/${server.id}/invites`).then(setInvites);
  useEffect(() => { void load(); }, [server.id]);
  return (
    <section>
      <h2>Convites</h2>
      {!invites ? <p className="muted">Carregando…</p> : invites.length === 0 ? <p className="muted">Nenhum convite ativo.</p> : (
        <table className="table">
          <thead><tr><th>Criado por</th><th>Código</th><th>Usos</th><th>Expira</th><th /></tr></thead>
          <tbody>
            {invites.map((i) => (
              <tr key={i.code}>
                <td>{i.inviter.displayName}</td>
                <td><code title={inviteLink(i.code)}>{i.code}</code></td>
                <td>{i.uses}{i.maxUses ? ` / ${i.maxUses}` : ''}</td>
                <td>{i.expiresAt ? new Date(i.expiresAt).toLocaleString('pt-BR') : 'Nunca'}</td>
                <td><button className="btn small danger" onClick={async () => { await api(`/invites/${i.code}`, { method: 'DELETE' }); await load(); }}>Revogar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Bans({ server }: { server: Server }) {
  const [bans, setBans] = useState<{ user: User; reason: string }[] | null>(null);
  const load = () => api(`/servers/${server.id}/bans`).then(setBans);
  useEffect(() => { void load(); }, [server.id]);
  return (
    <section>
      <h2>Banimentos</h2>
      {!bans ? <p className="muted">Carregando…</p> : bans.length === 0 ? <p className="muted">Ninguém foi banido.</p> : bans.map((b) => (
        <div key={b.user.id} className="member-admin">
          <Avatar user={b.user} size={32} />
          <div className="grow"><strong>{b.user.displayName}</strong> <small className="muted">{b.reason}</small></div>
          <button className="btn small" onClick={async () => { await api(`/servers/${server.id}/bans/${b.user.id}`, { method: 'DELETE' }); await load(); }}>Revogar banimento</button>
        </div>
      ))}
    </section>
  );
}

