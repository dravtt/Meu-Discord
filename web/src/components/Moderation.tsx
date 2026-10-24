import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';
import { closeModal, Dialog } from './Modal';

export const REPORT_REASONS: Record<string, string> = {
  spam: 'Spam ou propaganda',
  harassment: 'Assédio ou ofensas',
  adult: 'Conteúdo +18 sem aviso ou com menores',
  scam: 'Golpe ou tentativa de roubar conta',
  other: 'Outro motivo',
};

const KIND_LABEL: Record<string, string> = {
  message: 'Mensagens rápidas demais ou repetidas',
  friend: 'Pedidos de amizade demais',
  dm: 'Conversas novas demais',
  invite: 'Convites demais',
  join: 'Entrou em servidores demais',
  server: 'Criou servidores demais',
  mute: 'Silenciado',
};

const dateTime = (d: string) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Report a person (or one of their messages) to the Voka admins. */
export function ReportDialog({ user, message }: { user: Pick<User, 'id' | 'displayName'>; message?: { id: string; content: string } }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState('busy');
    setError(null);
    try {
      await api('/reports', { body: { targetId: user.id, messageId: message?.id, reason, details } });
      setState('sent');
    } catch (e) { setError((e as Error).message); setState('idle'); }
  }

  if (state === 'sent') {
    return (
      <Dialog title="Denúncia enviada" footer={<button className="btn primary" onClick={closeModal}>Fechar</button>}>
        <p>Obrigado! A administração do Voka vai analisar. Se quiser, você também pode bloquear essa pessoa pelo menu do botão direito.</p>
      </Dialog>
    );
  }
  return (
    <Dialog title={message ? 'Denunciar mensagem' : `Denunciar ${user.displayName}`} footer={<>
      <button className="btn ghost" onClick={closeModal}>Cancelar</button>
      <button className="btn danger" disabled={!reason || state === 'busy'} onClick={() => void send()}>Enviar denúncia</button>
    </>}>
      {message && <blockquote className="report-quote">{message.content || '(mensagem sem texto)'}</blockquote>}
      <p className="muted small">O que está acontecendo?</p>
      <div className="report-reasons" role="radiogroup">
        {Object.entries(REPORT_REASONS).map(([id, label]) => (
          <label key={id} className={`report-reason ${reason === id ? 'active' : ''}`}>
            <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} /> {label}
          </label>
        ))}
      </div>
      <label>Detalhes (opcional)<textarea rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Conte o que aconteceu" /></label>
      {error && <p className="error">{error}</p>}
    </Dialog>
  );
}

interface LogEntry { id: string; kind: string; createdAt: string; mutedUntil: string | null; serverName: string | null; channelName: string | null; user: User }

function SpamLogList({ entries }: { entries: LogEntry[] | null }) {
  if (!entries) return <p className="muted">Carregando…</p>;
  if (!entries.length) return <p className="muted">Ninguém foi travado pelo antispam ainda.</p>;
  return (
    <div className="mod-list">
      {entries.map((l) => (
        <div key={l.id} className={`mod-row ${l.kind === 'mute' ? 'mute' : ''}`}>
          <Avatar user={l.user} size={28} />
          <span className="mod-main">
            <strong>{l.user.displayName}</strong> <span className="muted small">{l.user.username}</span>
            <small>{KIND_LABEL[l.kind] ?? l.kind}{l.mutedUntil ? ` até ${dateTime(l.mutedUntil)}` : ''}{l.channelName ? ` · #${l.channelName}` : ''}{l.serverName ? ` · ${l.serverName}` : ''}</small>
          </span>
          <time className="muted small">{dateTime(l.createdAt)}</time>
        </div>
      ))}
    </div>
  );
}

/** Server settings tab: who the antispam stopped in this server. */
export function ServerSpamLog({ serverId }: { serverId: string }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  useEffect(() => { void api<LogEntry[]>(`/servers/${serverId}/spam-log`).then(setEntries).catch(() => setEntries([])); }, [serverId]);
  return (
    <section>
      <h2>Registro de spam</h2>
      <p className="muted">Quem foi travado pelo antispam neste servidor. Quem é travado 3 vezes em uma hora fica silenciado: 10 min na primeira vez, depois 1 h, 6 h e 24 h.</p>
      <SpamLogList entries={entries} />
    </section>
  );
}

type Account = User & { bannedAt: string | null; bannedReason: string; mutedUntil: string | null };
interface Report { id: string; reason: string; details: string; status: string; createdAt: string; messageContent: string; reporter: User; target: Account }

/** Settings > Administração: reports, the spam log of the whole Voka and suspended accounts. */
export function AdminPanel() {
  const [tab, setTab] = useState<'reports' | 'spam' | 'banned'>('reports');
  const [reports, setReports] = useState<Report[] | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [banned, setBanned] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api<Report[]>('/admin/reports').then(setReports).catch((e) => setError(e.message));
    void api<LogEntry[]>('/admin/spam-log').then(setLog).catch(() => setLog([]));
    void api<Account[]>('/admin/users/banned').then(setBanned).catch(() => setBanned([]));
  };
  useEffect(load, []);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try { await fn(); load(); } catch (e) { setError((e as Error).message); }
  }
  const resolve = (r: Report, status: string) => api(`/admin/reports/${r.id}`, { body: { status } });
  const ban = (r: Report) => {
    const reason = prompt(`Motivo da suspensão de ${r.target.displayName} (a pessoa vê esse texto):`, '');
    if (reason !== null) void run(async () => { await api(`/admin/users/${r.target.id}/ban`, { body: { reason } }); await resolve(r, 'actioned'); });
  };
  const mute = (r: Report, minutes: number) => run(async () => { await api(`/admin/users/${r.target.id}/mute`, { body: { minutes } }); await resolve(r, 'actioned'); });

  return (
    <section>
      <h2>Administração</h2>
      <div className="segmented-sm" role="tablist" style={{ marginBottom: 14 }}>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Denúncias{reports?.length ? ` (${reports.length})` : ''}</button>
        <button className={tab === 'spam' ? 'active' : ''} onClick={() => setTab('spam')}>Registro de spam</button>
        <button className={tab === 'banned' ? 'active' : ''} onClick={() => setTab('banned')}>Contas suspensas</button>
      </div>
      {error && <p className="error">{error}</p>}
      {tab === 'reports' && (!reports ? <p className="muted">Carregando…</p> : !reports.length ? <p className="muted">Nenhuma denúncia aberta.</p> : (
        <div className="mod-list">
          {reports.map((r) => (
            <div key={r.id} className="report-card">
              <div className="mod-row">
                <Avatar user={r.target} size={32} />
                <span className="mod-main">
                  <strong>{r.target.displayName}</strong> <span className="muted small">{r.target.username}</span>
                  <small>{REPORT_REASONS[r.reason] ?? r.reason} · denunciado por {r.reporter.displayName} · {dateTime(r.createdAt)}</small>
                </span>
                {r.target.bannedAt && <span className="tag danger">Suspensa</span>}
                {!r.target.bannedAt && r.target.mutedUntil && <span className="tag">Silenciada</span>}
              </div>
              {r.messageContent && <blockquote className="report-quote">{r.messageContent}</blockquote>}
              {r.details && <p className="small">"{r.details}"</p>}
              <div className="pe-row">
                {!r.target.bannedAt && <button className="btn small danger" onClick={() => ban(r)}>Suspender conta</button>}
                {!r.target.bannedAt && <button className="btn small" onClick={() => void mute(r, 24 * 60)}>Silenciar 24 h</button>}
                <button className="btn small ghost" onClick={() => void run(() => resolve(r, 'dismissed'))}>Ignorar</button>
              </div>
            </div>
          ))}
        </div>
      ))}
      {tab === 'spam' && <SpamLogList entries={log} />}
      {tab === 'banned' && (!banned ? <p className="muted">Carregando…</p> : !banned.length ? <p className="muted">Nenhuma conta suspensa.</p> : (
        <div className="mod-list">
          {banned.map((u) => (
            <div key={u.id} className="mod-row">
              <Avatar user={u} size={28} />
              <span className="mod-main"><strong>{u.displayName}</strong> <span className="muted small">{u.username}</span>
                <small>Suspensa em {dateTime(u.bannedAt!)}{u.bannedReason ? ` · ${u.bannedReason}` : ''}</small></span>
              <button className="btn small" onClick={() => void run(() => api(`/admin/users/${u.id}/ban`, { method: 'DELETE' }))}>Reativar</button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
