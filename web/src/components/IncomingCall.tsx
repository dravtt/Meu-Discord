import { useEffect } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { api } from '../lib/api';
import { findChannel, set, useStore } from '../lib/store';
import { startRingtone } from '../lib/sounds';
import { joinCall, useCall, useIncomingCall } from '../lib/voice';
import { Avatar } from './Avatar';

/** The "X is calling you" card with Accept / Decline, plus the short notice after a call ends. */
export function IncomingCall() {
  const incoming = useIncomingCall();
  const notice = useCall((s) => s.notice);
  const dnd = useStore((s) => s.me?.status === 'dnd');
  useStore((s) => s.dms);
  const channel = incoming ? findChannel(incoming.channelId) : undefined;
  const caller = channel?.recipients?.find((u) => u.id === incoming?.callerId);

  useEffect(() => {
    if (!incoming || dnd) return;
    return startRingtone();
  }, [incoming, dnd]);

  async function accept() {
    if (!incoming) return;
    useIncomingCall.setState(null, true);
    set({ view: { kind: 'home', dmId: incoming.channelId }, openThreadId: null });
    await joinCall(incoming.channelId);
  }

  async function decline() {
    if (!incoming) return;
    useIncomingCall.setState(null, true);
    await api(`/channels/${incoming.channelId}/call/decline`, { method: 'POST' }).catch(() => {});
  }

  return (
    <>
      {incoming && (
        <div className="incoming-call" role="alertdialog" aria-label="Chamada recebida">
          <div className="incoming-avatar">
            {caller ? <Avatar user={caller} size={88} /> : <span className="group-icon big">{channel?.recipients?.length ?? ''}</span>}
          </div>
          <strong>{caller?.displayName ?? 'Alguém'}</strong>
          <span className="muted">{channel?.type === 'group_dm' ? `está chamando o grupo ${channel.name || ''}` : 'está te ligando…'}</span>
          <div className="incoming-actions">
            <button className="round danger" title="Recusar" onClick={decline}><PhoneOff size={24} /></button>
            <button className="round accept" title="Aceitar" onClick={accept}><Phone size={24} /></button>
          </div>
          <div className="incoming-labels"><span>Recusar</span><span>Aceitar</span></div>
        </div>
      )}
      {notice && <div className="call-toast">{notice}</div>}
    </>
  );
}
