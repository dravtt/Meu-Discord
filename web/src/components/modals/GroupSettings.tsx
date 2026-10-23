import { useState } from 'react';
import { Camera, Crown, LogOut, UserMinus, UserPlus, Users } from 'lucide-react';
import { api, assetUrl } from '../../lib/api';
import { useStore } from '../../lib/store';
import { uploadImage } from '../../lib/upload';
import type { Channel } from '../../lib/types';
import { Avatar } from '../Avatar';
import { closeModal, confirmDialog, Dialog, openModal } from '../Modal';
import { NewGroupModal } from './NewGroupModal';

/** A group DM's picture, or the people icon when it has none. */
export function GroupIcon({ channel, size = 32 }: { channel: Pick<Channel, 'iconUrl'>; size?: number }) {
  return channel.iconUrl
    ? <img className="group-icon img" src={assetUrl(channel.iconUrl)} alt="" style={{ width: size, height: size }} />
    : <span className="group-icon" style={{ width: size, height: size }}><Users size={Math.round(size * 0.55)} /></span>;
}

export function leaveGroup(dm: Channel, title: string) {
  confirmDialog('Sair do grupo', `Sair de ${title}? Você não vai mais receber as mensagens desse grupo.`, 'Sair do grupo', async () => {
    await api(`/dms/${dm.id}/recipients/@me`, { method: 'DELETE' });
  });
}

/** Name, picture and members of a group DM. Anyone in the group can rename it; the owner can remove people. */
export function GroupSettings({ channelId }: { channelId: string }) {
  const dm = useStore((s) => s.dms[channelId]);
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(dm?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!dm) return null;
  const isOwner = dm.ownerId === me.id;
  const fallbackName = (dm.recipients ?? []).filter((u) => u.id !== me.id).map((u) => u.displayName).join(', ');

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try { await api(`/dms/${dm!.id}`, { method: 'PATCH', body }); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Dialog title="Editar grupo" footer={<>
      <button className="btn ghost" onClick={closeModal}>Fechar</button>
      <button className="btn primary" disabled={busy || name.trim() === dm.name} onClick={() => patch({ name: name.trim() })}>Salvar nome</button>
    </>}>
      <div className="group-edit-head">
        <label className="group-photo" title="Trocar a foto do grupo">
          <GroupIcon channel={dm} size={88} />
          <span className="group-photo-overlay"><Camera size={22} /> Trocar</span>
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try { await patch({ iconUrl: await uploadImage(f) }); } catch (err) { setError((err as Error).message); setBusy(false); }
          }} />
        </label>
        <div className="grow">
          <label>Nome do grupo<input value={name} maxLength={100} placeholder={fallbackName} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() !== dm.name) void patch({ name: name.trim() }); }} /></label>
          {dm.iconUrl && <button className="link" onClick={() => patch({ iconUrl: null })}>Remover foto</button>}
        </div>
      </div>
      <div className="section-title"><span>Membros — {dm.recipients?.length ?? 0}</span>
        <button className="icon-btn small" title="Adicionar amigos" onClick={() => openModal(<NewGroupModal from={dm} />)}><UserPlus size={16} /></button>
      </div>
      <div className="group-members">
        {(dm.recipients ?? []).map((u) => (
          <div key={u.id} className="group-member">
            <Avatar user={u} size={32} showStatus />
            <span className="grow">{u.displayName}{u.id === me.id && <small className="muted"> (você)</small>}</span>
            {dm.ownerId === u.id && <Crown size={14} className="owner-crown" aria-label="Dono do grupo" />}
            {isOwner && u.id !== me.id && (
              <button className="icon-btn small danger" title={`Remover ${u.displayName}`} onClick={() => confirmDialog('Remover do grupo', `Remover ${u.displayName} do grupo?`, 'Remover', async () => {
                await api(`/dms/${dm.id}/recipients/${u.id}`, { method: 'DELETE' });
                openModal(<GroupSettings channelId={channelId} />);
              })}><UserMinus size={16} /></button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn ghost danger leave-group" onClick={() => leaveGroup(dm, dm.name || fallbackName)}><LogOut size={16} /> Sair do grupo</button>
    </Dialog>
  );
}
