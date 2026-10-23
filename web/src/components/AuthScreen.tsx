import { useState, type FormEvent } from 'react';
import { ApiError, api, setToken } from '../lib/api';
import { forgetAccount, savedAccounts, switchTo } from '../lib/accounts';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';
import { Logo } from './Logo';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accounts = savedAccounts();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login' ? { username, password } : { username, password, email, birthdate, displayName: displayName || undefined };
      const res = await api<{ token: string }>(`/auth/${mode}`, { body });
      setToken(res.token);
      onAuthed();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Logo size={64} className="logo-mark" />
        <h1>{mode === 'login' ? 'Bem-vindo de volta!' : 'Criar uma conta'}</h1>
        <p className="muted">{mode === 'login' ? 'Entre para continuar no Voka.' : 'Leva menos de um minuto.'}</p>
        {mode === 'register' && <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus /></label>}
        <label>{mode === 'login' ? 'Nome de usuário ou e-mail' : 'Nome de usuário'}
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={mode === 'login'} required autoComplete="username" /></label>
        {mode === 'register' && <label>Nome de exibição<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Opcional" /></label>}
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {mode === 'register' && <label>Data de nascimento<input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} required max={new Date().toISOString().slice(0, 10)} /></label>}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Continuar'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'Precisa de uma conta? Cadastre-se' : 'Já tem uma conta? Entrar'}
        </button>
        {accounts.length > 0 && (
          <div className="auth-accounts">
            <small className="muted">Contas salvas neste aparelho</small>
            {accounts.map((a) => (
              <div key={a.id} className="auth-account">
                <button type="button" onClick={() => switchTo(a)}>
                  <Avatar user={{ id: a.id, displayName: a.displayName, avatarUrl: a.avatarUrl }} size={32} />
                  <span><strong>{a.displayName}</strong><small>{a.username}</small></span>
                </button>
                <button type="button" className="link small" onClick={() => { forgetAccount(a.id); location.reload(); }}>Remover</button>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}

/** Shown after sign-up until the 6-digit code sent by e-mail is typed in. */
export function VerifyEmailScreen({ me, onVerified, onLogout }: { me: User; onVerified: () => void; onLogout: () => void }) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState(me.email ?? '');
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Erro inesperado' }); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/users/@me/email/verify', { body: { code } }); onVerified(); }); }}>
        <Logo size={64} className="logo-mark" />
        <h1>Confirme seu e-mail</h1>
        {editing
          ? <>
            <p className="muted">Corrija o endereço e mandamos um código novo.</p>
            <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <button type="button" className="btn primary block" disabled={busy} onClick={() => void run(async () => {
              await api('/users/@me/email', { method: 'PUT', body: { email } });
              setEditing(false);
              setMsg({ ok: true, text: 'Código enviado para o novo e-mail.' });
            })}>Salvar e enviar código</button>
            <button type="button" className="link" onClick={() => setEditing(false)}>Cancelar</button>
          </>
          : <>
            <p className="muted">Mandamos um código de 6 números para <strong>{email}</strong>. Ele vale por 15 minutos.</p>
            <label>Código<input className="code-input" value={code} inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code" placeholder="000000"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
            {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
            <button className="btn primary block" disabled={busy || code.length !== 6}>Confirmar</button>
            <div className="auth-links">
              <button type="button" className="link" disabled={busy} onClick={() => void run(async () => {
                await api('/users/@me/email/resend', { method: 'POST' });
                setMsg({ ok: true, text: 'Código reenviado. Olhe também a caixa de spam.' });
              })}>Reenviar código</button>
              <button type="button" className="link" onClick={() => { setEditing(true); setMsg(null); }}>Trocar e-mail</button>
              <button type="button" className="link" onClick={onLogout}>Sair</button>
            </div>
          </>}
        {editing && msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      </form>
    </div>
  );
}
