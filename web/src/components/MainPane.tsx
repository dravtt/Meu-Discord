import { useEffect } from 'react';
import { useStore, set, findChannel } from '../lib/store';
import { has, P } from '../lib/permissions';
import { joinCall, useCall, useIncomingCall } from '../lib/voice';
import { Phone, PhoneOff } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import type { Channel } from '../lib/types';
import { Chat } from './Chat';
import { FriendsView } from './FriendsView';
import { MemberList } from './MemberList';
import { CallView } from './CallView';

export function MainPane() {
  const view = useStore((s) => s.view);
  const server = useStore((s) => (s.view.kind === 'server' ? s.servers[s.view.serverId] : undefined));
  const dm = useStore((s) => (s.view.kind === 'home' && s.view.dmId ? s.dms[s.view.dmId] : undefined));
  const showMembers = useStore((s) => s.showMembers);
  const openThreadId = useStore((s) => s.openThreadId);
  const callChannel = useCall((s) => s.channelId);
  const ringingHere = useIncomingCall((r) => !!dm && r?.channelId === dm.id);
  const dmCallers = useStore((s) => (dm ? Object.values(s.voiceStates).filter((v) => v.channelId === dm.id).length : 0));

  // Default to the first text channel the user can read.
  useEffect(() => {
    if (view.kind !== 'server' || !server) return;
    if (view.channelId && server.channels.some((c) => c.id === view.channelId)) return;
    const first = server.channels.filter((c) => c.type === 'text').sort((a, b) => a.position - b.position)[0];
    set({ view: { kind: 'server', serverId: server.id, channelId: first?.id } });
  }, [view, server]);

  if (view.kind === 'home') {
    if (!dm) return <main className="main"><FriendsView /></main>;
    return (
      <main className="main column">
        {callChannel === dm.id ? <CallView channelId={dm.id} compact /> : ringingHere ? <RingingPreview dm={dm} /> : dmCallers > 0 && (
          <div className="call-banner">
            <Phone size={18} /> <span>Chamada em andamento</span>
            <button className="btn small accept" onClick={() => joinCall(dm.id)}>Entrar</button>
          </div>
        )}
        <Chat key={dm.id} channel={dm} />
      </main>
    );
  }
  if (!server) return <main className="main" />;
  const channel = server.channels.find((c) => c.id === view.channelId);
  if (!channel) return <main className="main empty-state"><p>Nenhum canal de texto disponível.</p></main>;

  if (channel.type === 'voice') {
    return <main className="main"><CallView channelId={channel.id} /></main>;
  }
  const thread = openThreadId ? findChannel(openThreadId) : undefined;
  return (
    <main className="main">
      <Chat channel={channel} />
      {thread && <div className="thread-panel"><Chat channel={thread} isThread onClose={() => set({ openThreadId: null })} /></div>}
      {!thread && showMembers && has(channel.permissions, P.VIEW_CHANNEL) && <MemberList server={server} channel={channel} />}
    </main>
  );
}

/** Someone is calling and we are looking at that conversation: shows who is in the call, with Accept / Decline.
 *  Nobody gets the green speaking ring here, because we have not joined yet. */
function RingingPreview({ dm }: { dm: Channel }) {
  const incoming = useIncomingCall();
  const voiceStates = useStore((s) => s.voiceStates);
  const ids = Object.values(voiceStates).filter((v) => v.channelId === dm.id).map((v) => v.userId);
  if (incoming?.callerId && !ids.includes(incoming.callerId)) ids.unshift(incoming.callerId);
  const people = ids.map((id) => dm.recipients?.find((u) => u.id === id)).filter((u): u is NonNullable<typeof u> => !!u);
  const n = Math.max(1, people.length);
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;

  async function accept() {
    useIncomingCall.setState(null, true);
    await joinCall(dm.id);
  }
  async function decline() {
    useIncomingCall.setState(null, true);
    await api(`/channels/${dm.id}/call/decline`, { method: 'POST' }).catch(() => {});
  }

  return (
    <div className="call compact">
      <div className="call-status ringing">Chamada recebida…</div>
      <div className="call-stage grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {people.map((u) => (
          <div key={u.id} className="call-tile">
            <div className="tile-avatar"><Avatar user={u} size={96} /></div>
            <span className="tile-name">{u.displayName}</span>
          </div>
        ))}
      </div>
      <div className="call-controls">
        <button className="round danger" title="Recusar" onClick={decline}><PhoneOff size={22} /></button>
        <button className="round accept" title="Aceitar" onClick={accept}><Phone size={22} /></button>
      </div>
    </div>
  );
}
