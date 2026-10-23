import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { api, setToken } from '../../lib/api';
import { forgetAccount } from '../../lib/accounts';
import { useStore, set } from '../../lib/store';
import { applyVoiceSettings, leaveCall, useCall, useMicLevel } from '../../lib/voice';
import { audioConstraints, keyLabel, saveVoiceSettings, useVoiceSettings, type VoiceSettings } from '../../lib/voiceSettings';
import { savePrefs, THEMES, usePrefs, type ServerNotify } from '../../lib/prefs';
import { playMessage } from '../../lib/sounds';
import { ProfileEditor } from './ProfileEditor';
import { closeModal } from '../Modal';

type Tab = 'profile' | 'account' | 'appearance' | 'voice' | 'notifications';

export function UserSettings() {
  const me = useStore((s) => s.me)!;
  const [tab, setTab] = useState<Tab>('profile');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(body: Record<string, unknown>) {
    try {
      const updated = await api('/users/@me', { method: 'PATCH', body });
      set((s) => ({ me: updated, presence: { ...s.presence, [updated.id]: { ...s.presence[updated.id], status: updated.status, customStatus: updated.customStatus } } }));
      setMsg({ ok: true, text: 'Alterações salvas!' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  async function logout() {
    await leaveCall();
    if (me) forgetAccount(me.id);
    setToken(null);
    location.reload();
  }

  return (
    <div className="dialog settings">
      <nav className="settings-nav">
        <small className="muted">Configurações de usuário</small>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => { setTab('profile'); setMsg(null); }}>Perfil</button>
        <button className={tab === 'account' ? 'active' : ''} onClick={() => { setTab('account'); setMsg(null); }}>Minha conta</button>
        <small className="muted nav-group">Configurações do app</small>
        <button className={tab === 'appearance' ? 'active' : ''} onClick={() => { setTab('appearance'); setMsg(null); }}>Aparência</button>
        <button className={tab === 'voice' ? 'active' : ''} onClick={() => { setTab('voice'); setMsg(null); }}>Voz e vídeo</button>
        <button className={tab === 'notifications' ? 'active' : ''} onClick={() => { setTab('notifications'); setMsg(null); }}>Notificações</button>
        <button className="danger" onClick={logout}>Sair</button>
      </nav>
      <div className="settings-body">
        <button className="icon-btn close" onClick={closeModal}><X size={20} /></button>
        {tab === 'voice' ? <VoiceSettingsPanel /> : tab === 'appearance' ? <AppearancePanel /> : tab === 'notifications' ? <NotificationsPanel /> : tab === 'profile' ? (
          <ProfileEditor />
        ) : (
          <section>
            <h2>Minha conta</h2>
            <AccountPanel onMsg={setMsg} />
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

const COOLDOWN_DAYS = 14;

/** E-mail, username (changeable every two weeks) and birth date. */
function AccountPanel({ onMsg }: { onMsg: (m: { ok: boolean; text: string } | null) => void }) {
  const me = useStore((s) => s.me)!;
  const [username, setUsername] = useState(me.username);
  const [password, setPassword] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const changedAt = me.usernameChangedAt ? new Date(me.usernameChangedAt) : null;
  const nextChange = changedAt ? new Date(changedAt.getTime() + COOLDOWN_DAYS * 86400000) : null;
  const locked = !!nextChange && nextChange > new Date();

  async function run(fn: () => Promise<void>) {
    onMsg(null);
    try { await fn(); } catch (e) { onMsg({ ok: false, text: (e as Error).message }); }
  }

  return (
    <div className="account-panel">
      <div className="account-row">
        <span className="muted small">E-mail</span>
        <strong>{me.email ?? 'Nenhum e-mail (conta antiga)'}</strong>
      </div>
      <h3>Nome de usuário</h3>
      <p className="muted small">
        Atual: <strong>{me.username}</strong>. Dá para trocar a cada {COOLDOWN_DAYS} dias, e um nome que já é de outra pessoa fica indisponível.
        {locked && <> Próxima troca liberada em <strong>{nextChange!.toLocaleDateString('pt-BR')}</strong>.</>}
      </p>
      <label>Novo nome de usuário<input value={username} maxLength={32} disabled={locked} onChange={(e) => setUsername(e.target.value.toLowerCase())} /></label>
      {username !== me.username && <label>Sua senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      <button className="btn primary" disabled={locked || username === me.username || !password} onClick={() => void run(async () => {
        const r = await api<{ username: string; usernameChangedAt: string }>('/users/@me/username', { method: 'PUT', body: { username, password } });
        set((s) => ({ me: s.me && { ...s.me, ...r } }));
        setPassword('');
        onMsg({ ok: true, text: 'Nome de usuário alterado!' });
      })}>Trocar nome de usuário</button>
      {!me.hasBirthdate && <>
        <h3>Data de nascimento</h3>
        <p className="muted small">Necessária para entrar em servidores +18. Só dá para informar uma vez.</p>
        <label>Data de nascimento<input type="date" value={birthdate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirthdate(e.target.value)} /></label>
        <button className="btn primary" disabled={!birthdate} onClick={() => void run(async () => {
          await api('/users/@me/birthdate', { method: 'PUT', body: { birthdate } });
          set({ me: await api('/users/@me') });
          onMsg({ ok: true, text: 'Data de nascimento salva.' });
        })}>Salvar data</button>
      </>}
    </div>
  );
}

function AppearancePanel() {
  const theme = usePrefs((p) => p.theme);
  return (
    <section>
      <h2>Aparência</h2>
      <h3>Tema</h3>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${theme === t.id ? 'active' : ''}`} onClick={() => savePrefs({ theme: t.id })} aria-pressed={theme === t.id}>
            <span className="theme-preview" style={{ background: t.swatch[0] }}>
              <i style={{ background: t.swatch[1] }} />
              <b style={{ background: t.swatch[2] }} />
            </span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <p className="muted small">O tema fica salvo neste computador.</p>
    </section>
  );
}

const NOTIFY_OPTIONS: [ServerNotify, string][] = [['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Nada']];

function NotificationsPanel() {
  const prefs = usePrefs();
  const servers = useStore(useShallow((s) => s.serverOrder.map((id) => s.servers[id]).filter(Boolean)));
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'granted'));
  return (
    <section>
      <h2>Notificações</h2>
      <label className="check switch-row"><input type="checkbox" checked={prefs.desktopNotifications} onChange={(e) => savePrefs({ desktopNotifications: e.target.checked })} /> Notificações na área de trabalho (quando o Voka está em segundo plano)</label>
      {prefs.desktopNotifications && permission !== 'granted' && (
        <p className="muted small">O navegador está bloqueando as notificações.{' '}
          {permission === 'default' && <button className="link" onClick={() => Notification.requestPermission().then(setPermission)}>Permitir agora</button>}
        </p>
      )}
      <label className="check switch-row"><input type="checkbox" checked={prefs.messageSounds} onChange={(e) => { savePrefs({ messageSounds: e.target.checked }); if (e.target.checked) playMessage(); }} /> Som de mensagem nova (PV e servidores)</label>
      <label className="check switch-row"><input type="checkbox" checked={prefs.callSounds} onChange={(e) => savePrefs({ callSounds: e.target.checked })} /> Sons de chamada (entrar, sair, mutar, transmissão)</label>
      <p className="muted small">Em "Não perturbe" nenhuma notificação nem som de mensagem toca.</p>
      {servers.length > 0 && <>
        <h3>Por servidor</h3>
        <div className="notify-servers">
          {servers.map((srv) => (
            <div key={srv.id} className="notify-server">
              <span>{srv.name}</span>
              <select value={prefs.serverNotify[srv.id] ?? 'all'} onChange={(e) => savePrefs((p) => ({ serverNotify: { ...p.serverNotify, [srv.id]: e.target.value as ServerNotify } }))}>
                {NOTIFY_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </>}
    </section>
  );
}

function VoiceSettingsPanel() {
  const settings = useVoiceSettings();
  const callSounds = usePrefs((p) => p.callSounds);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const load = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load);
  }, [testing]);

  // Wait for the next key press and use it as the push-to-talk key.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') saveVoiceSettings({ pttKey: e.code });
      setCapturing(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing]);

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
      <p className="muted small">Fale normalmente: a barra deve ficar no verde. Amarelo é alto, vermelho é estourado (afaste o microfone ou baixe o volume dele no Windows).</p>
      <MicTest active={testing} />
      <button className="btn small" onClick={() => setTesting(!testing)}>{testing ? 'Parar teste' : 'Testar microfone'}</button>

      <h3>Modo de entrada</h3>
      <div className="mode-pick">
        <label className={`mode-option ${settings.inputMode === 'voice' ? 'active' : ''}`}>
          <input type="radio" name="inputMode" checked={settings.inputMode === 'voice'} onChange={() => saveVoiceSettings({ inputMode: 'voice' })} />
          <span><strong>Detecção de voz</strong><small>Microfone aberto: transmite quando você fala</small></span>
        </label>
        <label className={`mode-option ${settings.inputMode === 'ptt' ? 'active' : ''}`}>
          <input type="radio" name="inputMode" checked={settings.inputMode === 'ptt'} onChange={() => saveVoiceSettings({ inputMode: 'ptt' })} />
          <span><strong>Apertar para falar</strong><small>Só transmite enquanto você segura a tecla</small></span>
        </label>
      </div>
      {settings.inputMode === 'ptt' ? (
        <div className="ptt-row">
          <div>
            <span className="field-label">Tecla de atalho</span>
            <button className={`btn key-capture ${capturing ? 'capturing' : ''}`} onClick={() => setCapturing(true)}>
              {capturing ? 'Pressione uma tecla…' : keyLabel(settings.pttKey)}
            </button>
          </div>
          <div className="grow">
            <span className="field-label">Atraso ao soltar: {settings.pttReleaseMs} ms</span>
            <input type="range" min={0} max={1000} step={20} value={settings.pttReleaseMs} onChange={(e) => saveVoiceSettings({ pttReleaseMs: Number(e.target.value) })} />
          </div>
          <p className="muted small full">Funciona com a janela do Voka em foco. A tecla não atrapalha quando você está digitando no chat.</p>
        </div>
      ) : (
        <>
          <h3>Nível de sensibilidade do microfone</h3>
          <label className="check switch-row"><input type="checkbox" checked={settings.autoSensitivity} onChange={(e) => saveVoiceSettings({ autoSensitivity: e.target.checked })} /> Determinar automaticamente a sensibilidade de entrada</label>
          <SensitivityMeter testing={testing} />
          {!settings.autoSensitivity && (
            <input type="range" className="sensitivity-slider" min={-80} max={-10} step={1} value={settings.sensitivityDb}
              aria-label="Sensibilidade do microfone" onChange={(e) => saveVoiceSettings({ sensitivityDb: Number(e.target.value) })} />
          )}
          <p className="muted small">
            {settings.autoSensitivity
              ? 'O Voka mede o barulho de fundo e só abre o microfone quando a sua voz passa dele.'
              : 'Arraste: tudo que fica à direita da marca é transmitido. Fale e veja se a barra passa da marca; o ruído de fundo deve ficar à esquerda.'}
            {' '}Clique em "Testar microfone" (ou entre numa chamada) para ver a barra se mexer.
          </p>
        </>
      )}

      <h3>Processamento de voz</h3>
      <label className="check"><input type="checkbox" checked={settings.noiseSuppression} onChange={(e) => update({ noiseSuppression: e.target.checked })} /> Supressão de ruído (tira barulho de fundo, ventilador, teclado)</label>
      <label className="check"><input type="checkbox" checked={settings.echoCancellation} onChange={(e) => update({ echoCancellation: e.target.checked })} /> Cancelamento de eco (evita que os outros se ouçam pela sua caixa de som)</label>
      <label className="check"><input type="checkbox" checked={settings.autoGainControl} onChange={(e) => update({ autoGainControl: e.target.checked })} /> Ganho automático (aumenta sozinho o volume da sua voz; pode deixar o som estourado)</label>
      <p className="muted small">Voz abafada? Desligue a supressão de ruído (e o cancelamento de eco se usar fone): eles cortam parte dos agudos da voz.</p>

      <h3>Sons</h3>
      <label className="check"><input type="checkbox" checked={callSounds} onChange={(e) => savePrefs({ callSounds: e.target.checked })} /> Efeitos sonoros da chamada (entrar, sair, mutar, desmutar, transmissão)</label>
    </section>
  );
}

const METER_MIN = -80;
const toPct = (db: number) => Math.max(0, Math.min(100, ((db - METER_MIN) / -METER_MIN) * 100));

/** Green while normal, yellow when loud, red when the input is clipping. */
function levelClass(db: number) {
  return db > -6 ? 'clip' : db > -18 ? 'loud' : 'ok';
}

/** Meter + threshold marker that follow the call's own gate, or a local test stream when not in a call. */
function SensitivityMeter({ testing }: { testing: boolean }) {
  const settings = useVoiceSettings();
  const inCall = useCall((s) => !!s.channelId);
  const live = useMicLevel();
  const [testDb, setTestDb] = useState(-100);
  useMicStream(!inCall && testing, (db) => setTestDb(db));
  const db = inCall ? live.db : testDb;
  const threshold = settings.autoSensitivity ? (inCall ? live.threshold : null) : settings.sensitivityDb;
  const open = threshold === null ? false : db >= threshold;
  return (
    <div className={`mic-meter big ${open ? 'open' : ''}`} title={`${Math.round(db)} dB`}>
      <div className="mic-meter-cover" style={{ width: `${100 - toPct(db)}%` }} />
      {threshold !== null && <div className="mic-meter-mark" style={{ left: `${toPct(threshold)}%` }} />}
      {threshold !== null && <span className={`mic-meter-state ${open ? 'on' : ''}`}>{open ? 'Transmitindo' : 'Silêncio'}</span>}
    </div>
  );
}

/** Opens the chosen microphone with the call's processing and reports its level about 30 times a second. */
function useMicStream(active: boolean, onLevel: (db: number) => void) {
  const s = useVoiceSettings();
  const cb = useRef(onLevel);
  cb.current = onLevel;
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const ctx = new AudioContext();
    navigator.mediaDevices.getUserMedia({ audio: audioConstraints(useVoiceSettings.getState()) }).then((st) => {
      if (stopped) { st.getTracks().forEach((t) => t.stop()); return; }
      stream = st;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(st).connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let smooth = -100;
      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
        const rms = 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-8);
        // Clipping shows up in the peak, not the average; let it push the meter into red.
        const db = Math.max(rms, 20 * Math.log10(peak || 1e-8) - 6);
        smooth = db > smooth ? db : smooth * 0.7 + db * 0.3;
        cb.current(smooth);
      }, 33);
    }).catch(() => {});
    return () => { stopped = true; clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); void ctx.close(); cb.current(-100); };
  }, [active, s.inputDeviceId, s.noiseSuppression, s.echoCancellation, s.autoGainControl]);
}

/** Live input level of the chosen microphone, colored from green (normal) to red (clipping). */
function MicTest({ active }: { active: boolean }) {
  const [db, setDb] = useState(-100);
  useMicStream(active, setDb);
  const cls = levelClass(db);
  return (
    <div className="mic-test">
      <div className="mic-meter">
        <div className="mic-meter-cover" style={{ width: `${100 - toPct(db)}%` }} />
      </div>
      <span className={`mic-test-label ${active ? cls : ''}`}>{!active ? '' : db < -60 ? 'Sem som' : cls === 'ok' ? 'Bom' : cls === 'loud' ? 'Alto' : 'Estourado'}</span>
    </div>
  );
}
