import { X } from 'lucide-react';
import { useState } from 'react';
import { api, setToken } from '../../lib/api';
import { useStore, set } from '../../lib/store';
import { uploadImage } from '../../lib/upload';
import { leaveCall } from '../../lib/voice';
import { Avatar } from '../Avatar';
import { closeModal } from '../Modal';

export function UserSettings() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<'profile' | 'account'>('profile');
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [customStatus, setCustomStatus] = useState(me.customStatus);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(body: Record<string, unknown>) {
    try {
      const updated = await api('/users/@me', { method: 'PATCH', body });
      set((s) => ({ me: updated, presence: { ...s.presence, [updated.id]: { status: updated.status, customStatus: updated.customStatus } } }));
      setMsg({ ok: true, text: 'Alterações salvas!' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  async function logout() {
    await leaveCall();
    setToken(null);
    location.reload();
  }

  return (
    <div className="dialog settings">
      <nav className="settings-nav">
        <small className="muted">Configurações de usuário</small>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => { setTab('profile'); setMsg(null); }}>Perfil</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => { setTab('account'); setMsg(null); }}>Minha conta</button>
        <button className="danger" onClick={logout}>Sair</button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn close" onClick={closeModal}><X size={20} /></button>
        {tab === 'profile' ? (
          <section>
            <h2>Perfil</h2>
            <div className="row gap"><Avatar user={me} size={72} />
              <label>Avatar<input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await save({ avatarUrl: await uploadImage(f) }); }} /></label>
              {me.avatarUrl && <button className="link" onClick={() => save({ avatarUrl: null })}>Remover</button>}
            </div>
            <label>Nome de exibição<input value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} /></label>
            <label>Status personalizado<input value={customStatus} maxLength={128} onChange={(e) => setCustomStatus(e.target.value)} placeholder="O que você está fazendo?" /></label>
            <label>Sobre mim<textarea value={bio} maxLength={190} onChange={(e) => setBio(e.target.value)} /></label>
            <button className="btn primary" onClick={() => save({ displayName, bio, customStatus })}>Salvar</button>
          </section>
        ) : (
          <section>
            <h2>Minha conta</h2>
            <p>Nome de usuário: <strong>{me.username}</strong></p>
            <h3>Alterar senha</h3>
            <label>Senha atual<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
            <label>Nova senha<input type="password" value={newPassword} minLength={8} onChange={(e) => setNewPassword(e.target.value)} /></label>
            <button className="btn primary" disabled={newPassword.length < 8} onClick={async () => { await save({ currentPassword, newPassword }); setCurrentPassword(''); setNewPassword(''); }}>Alterar senha</button>
          </section>
        )}
        {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      </div>
    </div>
  );
}
