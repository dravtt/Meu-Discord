import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, setToken } from '../../lib/api';
import { useStore, set } from '../../lib/store';
import { uploadImage } from '../../lib/upload';
import { applyVoiceSettings, leaveCall } from '../../lib/voice';
import { audioConstraints, saveVoiceSettings, useVoiceSettings, type VoiceSettings } from '../../lib/voiceSettings';
import { Avatar } from '../Avatar';
import { closeModal } from '../Modal';

export function UserSettings() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<'profile' | 'account' | 'voice'>('profile');
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
        <button className={tab === 'voice' ? 'active' : ''} onClick={() => { setTab('voice'); setMsg(null); }}>Voz e vídeo</button>
        <button className="danger" onClick={logout}>Sair</button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn close" onClick={closeModal}><X size={20} /></button>
        {tab === 'voice' ? <VoiceSettingsPanel /> : tab === 'profile' ? (
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

function VoiceSettingsPanel() {
  const settings = useVoiceSettings();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const load = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, [testing]);

  const update = (patch: Partial<VoiceSettings>) => { saveVoiceSettings(patch); void applyVoiceSettings(); };
  const inputs = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const outputs = devices.filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');

  return (
    <section>
      <h2>Voz e vídeo</h2>
      <label>Microfone
        <select value={settings.inputDeviceId} onChange={(e) => update({ inputDeviceId: e.target.value })}>
          <option value="default">Padrão do sistema</option>
          {inputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfone ${i + 1}`}</option>)}
        </select>
      </label>
      {outputs.length > 0 && (
        <label>Saída de áudio
          <select value={settings.outputDeviceId} onChange={(e) => update({ outputDeviceId: e.target.value })}>
            <option value="default">Padrão do sistema</option>
            {outputs.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Alto-falante ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      <h3>Teste de microfone</h3>
      <p className="muted small">Fale normalmente: a barra deve encher até a metade. Se ela vive cheia, desligue o ganho automático ou afaste o microfone.</p>
      <MicTest active={testing} />
      <button className="btn small" onClick={() => setTesting(!testing)}>{testing ? 'Parar teste' : 'Testar microfone'}</button>
      <h3>Processamento de voz</h3>
      <label className="check"><input type="checkbox" checked={settings.noiseSuppression} onChange={(e) => update({ noiseSuppression: e.target.checked })} /> Supressão de ruído (tira barulho de fundo, ventilador, teclado)</label>
      <label className="check"><input type="checkbox" checked={settings.echoCancellation} onChange={(e) => update({ echoCancellation: e.target.checked })} /> Cancelamento de eco (evita que os outros se ouçam pela sua caixa de som)</label>
      <label className="check"><input type="checkbox" checked={settings.autoGainControl} onChange={(e) => update({ autoGainControl: e.target.checked })} /> Ganho automático (aumenta sozinho o volume da sua voz; pode deixar o som estourado)</label>
    </section>
  );
}

/** Live input level of the chosen microphone, with the same processing the call uses. */
function MicTest({ active }: { active: boolean }) {
  const settings = useVoiceSettings();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    const ctx = new AudioContext();
    let stopped = false;
    navigator.mediaDevices.getUserMedia({ audio: audioConstraints(settings) }).then((s) => {
      if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(s).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        const db = 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-8);
        const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        if (bar.current) bar.current.style.width = `${pct}%`;
        raf = requestAnimationFrame(tick);
      };
      tick();
    }).catch(() => {});
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); void ctx.close(); if (bar.current) bar.current.style.width = '0'; };
  }, [active, settings]);
  return <div className="mic-meter"><div ref={bar} /></div>;
}
