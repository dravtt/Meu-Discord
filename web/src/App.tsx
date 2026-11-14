import { useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './lib/api';
import { forgetAccount, rememberAccount } from './lib/accounts';
import type { User } from './lib/types';
import { bootstrap, connectSocket, socket } from './lib/socket';
import { useStore, set, findChannel, mobileIntent } from './lib/store';
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
  // On phones, picking a conversation or channel moves to the chat; picking a server or Home just shows its list.
  const view = useStore((s) => s.view);
  const mobileView = useStore((s) => s.mobileView);
  const lastView = useRef(view);
  useEffect(() => {
    const prev = lastView.current;
    lastView.current = view;
    set({ mobileMembers: false });
    const container = (v: typeof view) => (v.kind === 'server' ? v.serverId : 'home');
    const target = (v: typeof view) => (v.kind === 'server' ? v.channelId : v.dmId);
    if (mobileIntent.chat) { mobileIntent.chat = false; set({ mobileView: 'chat' }); }
    else if (container(prev) !== container(view)) set({ mobileView: 'nav' });
    // A server's first channel is picked by the app itself (undefined -> id), which is not a tap.
    else if (target(prev) !== target(view) && !(view.kind === 'server' && !target(prev))) set({ mobileView: 'chat' });
  }, [view]);
  // Phones: swipe right on a chat to go back to the list. The chat follows the finger and slides away.
  useEffect(() => {
    let start: { x: number; y: number; t: number; el: HTMLElement | null; active: boolean } | null = null;
    const phone = () => window.matchMedia('(max-width: 700px)').matches;
    const pane = () => document.querySelector<HTMLElement>('.app.mobile-chat .main');
    const reset = (el: HTMLElement | null) => { document.querySelector<HTMLElement>('.app')?.removeAttribute('data-swiping'); if (el) { el.style.transition = ''; el.style.transform = ''; el.style.boxShadow = ''; } };
    const onStart = (e: TouchEvent) => {
      const el = e.target as HTMLElement;
      const blocked = e.touches.length !== 1 || !phone() || useStore.getState().mobileView !== 'chat'
        || el.closest('input, textarea, .modal-backdrop, .context-menu, .emoji-picker, .call-stage, .image-viewer, pre, code');
      start = blocked ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), el: pane(), active: false };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || !start.el) return;
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (!start.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { start = null; return; } // it is a scroll
        if (dx < 12 || dx < Math.abs(dy) * 1.5) return;
        start.active = true;
        document.querySelector<HTMLElement>('.app')?.setAttribute('data-swiping', '');
      }
      start.el.style.transition = 'none';
      start.el.style.transform = `translateX(${Math.max(0, dx)}px)`;
      start.el.style.boxShadow = '-12px 0 24px rgba(0,0,0,.35)';
    };
    const onEnd = (e: TouchEvent) => {
      const s0 = start; start = null;
      if (!s0 || !s0.el || !s0.active) return;
      const el = s0.el;
      const dx = e.changedTouches[0].clientX - s0.x;
      const fast = dx / Math.max(1, Date.now() - s0.t) > 0.5; // px per ms
      el.style.transition = 'transform .2s ease-out';
      if (dx > window.innerWidth * 0.33 || (fast && dx > 50)) {
        el.style.transform = 'translateX(100%)';
        setTimeout(() => {
          const st = useStore.getState();
          if (st.mobileMembers) set({ mobileMembers: false });
          else if (st.openThreadId) set({ openThreadId: null });
          else set({ mobileView: 'nav' });
          reset(el);
        }, 190);
      } else {
        el.style.transform = 'translateX(0)';
        setTimeout(() => reset(el), 210);
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart); document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd); document.removeEventListener('touchcancel', onEnd);
    };
  }, []);
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
    <div className={`app mobile-${mobileView}`} onClickCapture={(e) => {
      // Tapping a channel, a conversation or Friends in the list opens it, even if it was already the selected one.
      if ((e.target as HTMLElement).closest('.sidebar .channel-btn, .sidebar .dm-open, .sidebar .nav-item')) {
        set({ mobileView: 'chat' });
        mobileIntent.chat = true;
        setTimeout(() => { mobileIntent.chat = false; }, 100);
      }
    }}>
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
  mobileIntent.chat = true;
  if (c.type === 'thread') {
    set({ view: { kind: 'server', serverId: c.serverId!, channelId: c.parentId! }, openThreadId: c.id });
  } else if (c.serverId) set({ view: { kind: 'server', serverId: c.serverId, channelId: c.id }, openThreadId: null });
  else set({ view: { kind: 'home', dmId: c.id }, openThreadId: null });
}
