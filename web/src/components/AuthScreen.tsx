import { useState, type FormEvent } from 'react';
import { api, setToken } from '../lib/api';

export function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'login' ? { username, password } : { username, password, displayName: displayName || undefined };
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
        <div className="logo-mark">N</div>
        <h1>{mode === 'login' ? 'Bem-vindo de volta!' : 'Criar uma conta'}</h1>
        <p className="muted">{mode === 'login' ? 'Entre para continuar no Nexo.' : 'Leva menos de um minuto.'}</p>
        <label>Nome de usuário<input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoComplete="username" /></label>
        {mode === 'register' && <label>Nome de exibição<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Opcional" /></label>}
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={busy}>{mode === 'login' ? 'Entrar' : 'Continuar'}</button>
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'Precisa de uma conta? Cadastre-se' : 'Já tem uma conta? Entrar'}
        </button>
      </form>
    </div>
  );
}
