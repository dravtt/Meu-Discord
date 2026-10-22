import { useState } from 'react';
import { api } from '../../lib/api';
import { set, useStore } from '../../lib/store';
import type { Channel } from '../../lib/types';
import { Avatar } from '../Avatar';
import { Dialog, closeModal } from '../Modal';

export function NewGroupModal() {
  const friends = useStore((s) => s.relationships.filter((r) => r.type === 'friend'));
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    try {
      const dm = await api<Channel>('/dms', { body: { userIds: selected } });
      set((s) => ({ dms: { ...s.dms, [dm.id]: dm }, view: { kind: 'home', dmId: dm.id } }));
      closeModal();
    } catch (e) { setError((e as Error).message); }
  }
  return (
    <Dialog title="Selecionar amigos" footer={<><button className="btn ghost" onClick={closeModal}>Cancelar</button><button className="btn primary" disabled={!selected.length} onClick={create}>{selected.length > 1 ? 'Criar grupo' : 'Abrir conversa'}</button></>}>
      <p className="muted small">Você pode adicionar até 9 amigos.</p>
      {friends.length === 0 && <p className="muted">Adicione amigos primeiro.</p>}
      {friends.map((f) => (
        <label key={f.user.id} className="check row-item">
          <input type="checkbox" checked={selected.includes(f.user.id)} disabled={!selected.includes(f.user.id) && selected.length >= 9}
            onChange={(e) => setSelected(e.target.checked ? [...selected, f.user.id] : selected.filter((x) => x !== f.user.id))} />
          <Avatar user={f.user} size={28} /> {f.user.displayName} <small className="muted">{f.user.username}</small>
        </label>
      ))}
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}
