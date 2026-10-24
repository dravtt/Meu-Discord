import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './lib/api';
import { forgetAccount, rememberAccount } from './lib/accounts';
import type { User } from './lib/types';
import { bootstrap, connectSocket, socket } from './lib/socket';
import { useStore, set, findChannel } from './lib/store';
import { onNotificationClick, requestNotificationPermission, updateBadge } from './lib/notify';
import { AuthScreen, VerifyEmailScreen } from './components/AuthScreen';
import { ServerRail } from './components/ServerRail';
import { Sidebar } from './components/Sidebar';
import { MainPane } from './components/MainPane';
import { ModalHost } from './components/Modal';
import { IncomingCall } from './components/IncomingCall';
import { ContextMenuHost } from './components/ContextMenu';
import { SoundboardHost } from './components/Soundboard';
import { installPushToTalk } from './lib/micGate';
import { joinInviteFromUrl } from './components/modals/ServerModals';
import { restoreView } from './lib/session';
import { Logo } from './components/Logo';
import { startGameDetection } from './lib/gameDetect';
import { installKeybinds } from './lib/keybinds';

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState<User | null>(null);
  const [verifiedAt, setVerifiedAt] = useState(0);

  useEffect(() => installPushToTalk(), []);
  useEffect(() => (ready ? startGameDetection() : undefined), [ready]);
  useEffect(() => (ready ? installKeybinds() : undefined), [ready]);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<User>('/users/@me')
      .then((me) => {
        if (cancelled) return false;
        rememberAccount(me);
        // New accounts confirm their e-mail before anything else loads.
        if (me.emailVerified === false) { setUnverified(me); return false; }
        setUnverified(null);
        return bootstrap().then(() => true);
      })
      .then((loaded) => {
        if (cancelled || !loaded) return;
        restoreView();
        connectSocket();
        setReady(true);
        void requestNotificationPermission();
        void joinInviteFromUrl();
      })
      .catch((e) => setError(e.message));
    onNotificationClick((channelId) => openChannel(channelId));
    // Invite links pasted into the address bar while the app is open.
    const onHash = () => { void joinInviteFromUrl(); };
    window.addEventListener('hashchange', onHash);
    return () => { cancelled = true; socket?.disconnect(); window.removeEventListener('hashchange', onHash); };
  }, [token, verifiedAt]);

  // Unread mention count for the window title / taskbar badge.
  const badge = useStore((s) => Object.values(s.readStates).reduce((n, r) => n + r.mentions, 0));
  useEffect(() => updateBadge(badge), [badge]);

  if (!token) return <AuthScreen onAuthed={() => setTokenState(getToken())} />;
  if (unverified) {
    return <VerifyEmailScreen me={unverified} onVerified={() => { setUnverified(null); setVerifiedAt(Date.now()); }}
      onLogout={() => { forgetAccount(unverified.id); setToken(null); location.reload(); }} />;
  }
  if (error) return <div className="splash"><Logo size={64} className="logo-mark" /><p>Erro ao carregar: {error}</p></div>;
  if (!ready) return <div className="splash"><Logo size={64} className="logo-mark pulse" /><p>Carregando o Voka…</p></div>;

  return (
    <div className="app">
      <ServerRail />
      <Sidebar />
      <MainPane />
      <ModalHost />
      <IncomingCall />
      <ContextMenuHost />
      <SoundboardHost />
    </div>
  );
}

export function openChannel(channelId: string) {
  const c = findChannel(channelId);
  if (!c) return;
  if (c.type === 'thread') {
    set({ view: { kind: 'server', serverId: c.serverId!, channelId: c.parentId! }, openThreadId: c.id });
  } else if (c.serverId) set({ view: { kind: 'server', serverId: c.serverId, channelId: c.id }, openThreadId: null });
  else set({ view: { kind: 'home', dmId: c.id }, openThreadId: null });
}
