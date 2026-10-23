import { useEffect, useState } from 'react';
import { getToken } from './lib/api';
import { bootstrap, connectSocket, socket } from './lib/socket';
import { useStore, set, findChannel } from './lib/store';
import { onNotificationClick, requestNotificationPermission, updateBadge } from './lib/notify';
import { AuthScreen } from './components/AuthScreen';
import { ServerRail } from './components/ServerRail';
import { Sidebar } from './components/Sidebar';
import { MainPane } from './components/MainPane';
import { ModalHost } from './components/Modal';
import { IncomingCall } from './components/IncomingCall';
import { joinInviteFromUrl } from './components/modals/ServerModals';

export function App() {
  const [token, setTokenState] = useState(getToken());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    bootstrap()
      .then(() => {
        if (cancelled) return;
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
  }, [token]);

  // Unread mention count for the window title / taskbar badge.
  const badge = useStore((s) => Object.values(s.readStates).reduce((n, r) => n + r.mentions, 0));
  useEffect(() => updateBadge(badge), [badge]);

  if (!token) return <AuthScreen onAuthed={() => setTokenState(getToken())} />;
  if (error) return <div className="splash"><div className="logo-mark">N</div><p>Erro ao carregar: {error}</p></div>;
  if (!ready) return <div className="splash"><div className="logo-mark pulse">N</div><p>Carregando o Nexo…</p></div>;

  return (
    <div className="app">
      <ServerRail />
      <Sidebar />
      <MainPane />
      <ModalHost />
      <IncomingCall />
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
