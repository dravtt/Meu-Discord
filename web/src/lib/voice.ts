import { create } from 'zustand';
import { AudioPresets, LocalAudioTrack, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets, type Participant, type RemoteParticipant } from 'livekit-client';
import { api } from './api';
import { socket } from './socket';
import { audioConstraints, useVoiceSettings } from './voiceSettings';
import { playDeafen, playHangup, playJoin, playLeave, playMute, playStreamStart, playUndeafen, playUnmute, startRingback } from './sounds';
import { MicGate } from './micGate';
import { setSpeaking, watchRemoteAudio } from './speaking';
import { usePrefs } from './prefs';

/**
 * One box in the call grid per person. When they share their screen, the screen fills their box
 * (their camera, if on, shows small in a corner).
 */
export interface Tile { key: string; identity: string; name: string; local: boolean; camera?: Track; screen?: Track }

/** Live microphone level while in a call, for the settings screen. */
export const useMicLevel = create<{ db: number; threshold: number; open: boolean }>(() => ({ db: -100, threshold: -55, open: false }));

interface CallState {
  channelId: string | null;
  connecting: boolean;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  tiles: Tile[];
  /** We started a DM call and the other side's phone is still ringing. */
  ringing: boolean;
  /** Short message after a call ends on its own ("didn't answer", "declined"). */
  notice: string | null;
}

export const useCall = create<CallState>(() => ({ channelId: null, connecting: false, error: null, muted: false, deafened: false, video: false, screen: false, tiles: [], ringing: false, notice: null }));

/** An incoming DM call waiting for us to accept or decline. */
export const useIncomingCall = create<{ channelId: string; callerId: string } | null>(() => null);

let stopRingback: (() => void) | null = null;
function setRinging(ringing: boolean) {
  useCall.setState({ ringing });
  stopRingback?.();
  stopRingback = ringing ? startRingback() : null;
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function showCallNotice(notice: string) {
  useCall.setState({ notice });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => useCall.setState({ notice: null }), 5000);
}

/** Server says the ringing is over. If nobody picked up our call, hang up. */
export function onRingStopped(channelId: string, reason: string, declinedBy?: string) {
  if (useIncomingCall.getState()?.channelId === channelId) useIncomingCall.setState(null, true);
  const call = useCall.getState();
  if (call.channelId !== channelId || !call.ringing) return;
  setRinging(false);
  if (reason === 'answered') return;
  if (reason === 'timeout') showCallNotice('Ninguém atendeu a chamada');
  if (reason === 'declined') showCallNotice(declinedBy ? `${declinedBy} recusou a chamada` : 'A chamada foi recusada');
  if (room && room.remoteParticipants.size === 0) void leaveCall();
}

/** Applies new microphone/speaker settings to the live call, if there is one. */
export async function applyVoiceSettings() {
  if (!room) return;
  const s = useVoiceSettings.getState();
  const mic = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  if (mic instanceof LocalAudioTrack) await mic.restartTrack(audioConstraints()).catch(() => {});
  await room.switchActiveDevice('audiooutput', s.outputDeviceId).catch(() => {});
}

let room: Room | null = null;
let audioCtx: AudioContext | null = null;
const audioEls = new Map<string, HTMLMediaElement>();
const audioWatchers = new Map<string, () => void>();

/** Per-person volume and local mute from preferences; deafen silences everyone. */
export function applyVolumes() {
  if (!room) return;
  const { userVolume, userMuted } = usePrefs.getState();
  const deafened = useCall.getState().deafened;
  for (const p of room.remoteParticipants.values()) {
    const vol = deafened || userMuted[p.identity] ? 0 : (userVolume[p.identity] ?? 100) / 100;
    p.setVolume(vol, Track.Source.Microphone);
    p.setVolume(deafened ? 0 : 1, Track.Source.ScreenShareAudio);
  }
}
usePrefs.subscribe((p, prev) => { if (p.userVolume !== prev.userVolume || p.userMuted !== prev.userMuted) applyVolumes(); });

function visible(p: Participant, source: Track.Source) {
  const pub = p.getTrackPublication(source);
  return pub && !pub.isMuted ? pub.track : undefined;
}

function syncTiles() {
  if (!room) return useCall.setState({ tiles: [] });
  const local = room.localParticipant;
  const all: Participant[] = [local, ...room.remoteParticipants.values()];
  useCall.setState({
    tiles: all.map((p) => ({
      key: p.identity, identity: p.identity, name: p.name || p.identity, local: p === local,
      camera: visible(p, Track.Source.Camera), screen: visible(p, Track.Source.ScreenShare),
    })),
  });
}

/** Puts the mic gate (voice detection / push to talk) on the published microphone. */
async function attachGate() {
  const r = room;
  const mic = r?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
  if (!r || !(mic instanceof LocalAudioTrack) || mic.getProcessor()) return;
  audioCtx ??= new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  await audioCtx.resume().catch(() => {});
  mic.setAudioContext(audioCtx);
  const me = r.localParticipant.identity;
  await mic.setProcessor(new MicGate(({ open, db, threshold }) => {
    useMicLevel.setState({ open, db, threshold });
    setSpeaking(me, open && !useCall.getState().muted);
  })).catch((e) => console.warn('mic gate unavailable', e));
}

function sendState() {
  const { muted, deafened, video, screen } = useCall.getState();
  socket?.emit('voice:update', { muted, deafened, video, streaming: screen });
}

export async function joinCall(channelId: string) {
  if (useCall.getState().channelId === channelId) return;
  await leaveCall();
  useCall.setState({ channelId, connecting: true, error: null, notice: null, video: false, screen: false });
  try {
    const { url, token, canSpeak, ringing } = await api<{ url: string; token: string; canSpeak: boolean; ringing: boolean }>(`/channels/${channelId}/voice`, { method: 'POST' });
    if (ringing) setRinging(true);
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      // Mixing in Web Audio allows per-person volume above 100%.
      webAudioMix: true,
      audioOutput: { deviceId: useVoiceSettings.getState().outputDeviceId },
      audioCaptureDefaults: audioConstraints(),
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        // 96 kbps Opus. DTX stays off: it stops sending during quiet moments and makes voices cut out.
        audioPreset: AudioPresets.musicHighQuality,
        dtx: false,
        red: true,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
      },
    });
    room
      .on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        const key = `${participant.identity}:${track.sid}`;
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          audioEls.set(key, el);
          document.body.appendChild(el);
          if (pub.source === Track.Source.Microphone) audioWatchers.set(key, watchRemoteAudio(participant.identity, track.mediaStreamTrack));
          applyVolumes();
        }
        if (pub.source === Track.Source.ScreenShare) playStreamStart();
        syncTiles();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        const key = `${participant.identity}:${track.sid}`;
        audioEls.get(key)?.remove();
        audioEls.delete(key);
        audioWatchers.get(key)?.();
        audioWatchers.delete(key);
        track.detach();
        syncTiles();
      })
      .on(RoomEvent.ParticipantConnected, () => { if (useCall.getState().ringing) setRinging(false); playJoin(); syncTiles(); })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => { setSpeaking(p.identity, false); playLeave(); syncTiles(); })
      .on(RoomEvent.LocalTrackPublished, (pub) => { if (pub.source === Track.Source.Microphone) void attachGate(); syncTiles(); })
      .on(RoomEvent.TrackMuted, syncTiles)
      .on(RoomEvent.TrackUnmuted, syncTiles)
      .on(RoomEvent.LocalTrackUnpublished, () => { useCall.setState({ screen: !!room?.localParticipant.isScreenShareEnabled }); sendState(); syncTiles(); })
      .on(RoomEvent.Disconnected, () => { if (room) void leaveCall(); });
    await room.connect(url, token);
    useCall.setState({ connecting: false });
    playJoin();
    syncTiles();
    // The microphone prompt can take a while; do not hold the "connecting" state on it.
    if (canSpeak) {
      room.localParticipant.setMicrophoneEnabled(!useCall.getState().muted)
        .catch(() => useCall.setState({ muted: true }))
        .finally(() => { sendState(); syncTiles(); });
    } else {
      useCall.setState({ muted: true });
      sendState();
    }
  } catch (err) {
    useCall.setState({ connecting: false, error: (err as Error).message || 'Falha ao conectar na voz' });
    await leaveCall(true);
  }
}

export async function leaveCall(keepError = false) {
  const r = room;
  room = null;
  if (useCall.getState().ringing) setRinging(false);
  if (r) playHangup();
  for (const el of audioEls.values()) el.remove();
  audioEls.clear();
  for (const stop of audioWatchers.values()) stop();
  audioWatchers.clear();
  if (r) setSpeaking(r.localParticipant.identity, false);
  if (r) await r.disconnect();
  if (useCall.getState().channelId) {
    socket?.emit('voice:leave');
    await api('/voice', { method: 'DELETE' }).catch(() => {});
  }
  useCall.setState((s) => ({ channelId: null, connecting: false, tiles: [], video: false, screen: false, error: keepError ? s.error : null }));
}

async function setMuted(muted: boolean) {
  useCall.setState({ muted });
  if (room) {
    setSpeaking(room.localParticipant.identity, false);
    await room.localParticipant.setMicrophoneEnabled(!muted).catch(() => useCall.setState({ muted: true }));
  }
}

export async function toggleMute() {
  const { muted, deafened } = useCall.getState();
  // Unmuting while deafened undeafens too, like most voice apps.
  if (muted && deafened) return toggleDeafen();
  if (muted) playUnmute(); else playMute();
  await setMuted(!muted);
  sendState();
}

let mutedBeforeDeafen = false;
/** Deafening also mutes your mic; undeafening puts the mic back how it was. */
export async function toggleDeafen() {
  const deafened = !useCall.getState().deafened;
  if (deafened) { mutedBeforeDeafen = useCall.getState().muted; playDeafen(); } else playUndeafen();
  useCall.setState({ deafened });
  applyVolumes();
  await setMuted(deafened ? true : mutedBeforeDeafen);
  sendState();
}

export async function toggleVideo() {
  if (!room) return;
  const video = !useCall.getState().video;
  try {
    await room.localParticipant.setCameraEnabled(video);
    useCall.setState({ video });
  } catch { useCall.setState({ error: 'Não foi possível acessar a câmera' }); }
  sendState();
  syncTiles();
}

export type ScreenQuality = '720' | '1080' | 'source';
export interface ScreenOptions { quality: ScreenQuality; fps: 15 | 30 | 60; audio: boolean }

const SCREEN_SIZE: Record<ScreenQuality, { width: number; height: number }> = {
  '720': { width: 1280, height: 720 },
  '1080': { width: 1920, height: 1080 },
  source: { width: 3840, height: 2160 },
};
const SCREEN_BITRATE: Record<ScreenQuality, number> = { '720': 2_500_000, '1080': 4_500_000, source: 8_000_000 };

/** Starts sharing with the chosen quality. The browser (or the desktop app) asks which screen. */
export async function startScreen(o: ScreenOptions) {
  if (!room) return;
  try {
    await room.localParticipant.setScreenShareEnabled(true, {
      audio: o.audio,
      systemAudio: o.audio ? 'include' : 'exclude',
      resolution: { ...SCREEN_SIZE[o.quality], frameRate: o.fps },
      // Games and video look smoother as "motion"; text and code stay sharp as "detail".
      contentHint: o.fps >= 60 ? 'motion' : 'detail',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    }, {
      screenShareEncoding: { maxBitrate: Math.round(SCREEN_BITRATE[o.quality] * (o.fps >= 60 ? 1.5 : 1)), maxFramerate: o.fps },
    });
    useCall.setState({ screen: true });
  } catch { /* user cancelled the picker */ }
  sendState();
  syncTiles();
}

export async function stopScreen() {
  if (!room) return;
  await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
  useCall.setState({ screen: false });
  sendState();
  syncTiles();
}
