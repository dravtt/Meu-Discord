import { useShallow } from 'zustand/react/shallow';
import { useState } from 'react';
import { api } from '../../lib/api';
import { set, useStore } from '../../lib/store';
import type { Channel } from '../../lib/types';
import { Avatar } from '../Avatar';
import { Dialog, closeModal } from '../Modal';

/** Pick friends for a new group, or add people to the conversation `from` (a 1:1 becomes a new group). */
export function NewGroupModal({ from }: { from?: Channel } = {}) {
  const me = useStore((s) => s.me);
  const already = new Set((from?.recipients ?? []).map((u) => u.id));
  const friends = useStore(useShallow((s) => s.relationships.filter((r) => r.type === 'friend' && !already.has(r.user.id))));
  const room = 9 - Math.max(0, already.size - 1);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    try {
      let dm: Channel;
      if (from?.type === 'group_dm') {
        for (const id of selected) await api(`/dms/${from.id}/recipients/${id}`, { method: 'PUT' });
        dm = from;
      } else {
        const others = (from?.recipients ?? []).map((u) => u.id).filter((id) => id !== me?.id);
        dm = await api<Channel>('/dms', { body: { userIds: [...others, ...selected] } });
      }
      set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id } }));
      closeModal();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <Dialog title={from ? 'Adicionar amigos à conversa' : 'Criar grupo'} footer={<><button className="btn ghost" onClick={closeModal}>Cancelar</button><button className="btn primary" disabled={!selected.length} onClick={create}>{from?.type === 'group_dm' ? 'Adicionar' : from || selected.length > 1 ? 'Criar grupo' : 'Abrir conversa'}</button></>}>
      <p className="muted small">{from ? `Você pode adicionar mais ${room} amigo(s).` : 'Escolha 2 ou mais amigos para criar um grupo (até 9).'}</p>
      {friends.length === 0 && <p className="muted">Adicione amigos primeiro.</p>}
      {friends.map((f) => (
        <label key={f.user.id} className="check row-item">
          <input type="checkbox" checked={selected.includes(f.user.id)} disabled={!selected.includes(f.user.id) && selected.length >= room}
            onChange={(e) => setSelected(e.target.checked ? [...selected, f.user.id] : selected.filter((x) => x !== f.user.id))} />
          <Avatar user={f.user} size={28} /> {f.user.displayName} <small className="muted">{f.user.username}</small>
        </label>
      ))}
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
