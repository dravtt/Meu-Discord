import { useEffect } from 'react';
import { useStore, set, findChannel } from '../lib/store';
import { has, P } from '../lib/permissions';
import { joinCall, useCall, useIncomingCall } from '../lib/voice';
import { Phone } from 'lucide-react';
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
        {callChannel === dm.id ? <CallView channelId={dm.id} compact /> : dmCallers > 0 && !ringingHere && (
          <div className="call-banner">
            <Phone size={18} /> <span>Chamada em andamento</span>
            <button className="btn small accept" onClick={() => joinCall(dm.id)}>Entrar</button>
          </div>
        )}
        <Chat channel={dm} />
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
