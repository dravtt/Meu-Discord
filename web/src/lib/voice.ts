import { create } from 'zustand';
import { AudioPresets, Room, RoomEvent, ScreenSharePresets, Track, VideoPresets, type Participant } from 'livekit-client';
import { api } from './api';
import { socket } from './socket';

/** One box in the call grid: a person (camera or avatar) or a screen someone is sharing. */
export interface Tile { key: string; identity: string; name: string; kind: 'person' | 'screen'; local: boolean; speaking: boolean; track?: Track }

interface CallState {
  channelId: string | null;
  connecting: boolean;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  video: boolean;
  screen: boolean;
  tiles: Tile[];
}

export const useCall = create<CallState>(() => ({ channelId: null, connecting: false, error: null, muted: false, deafened: false, video: false, screen: false, tiles: [] }));

let room: Room | null = null;
const audioEls = new Map<string, HTMLMediaElement>();

function syncTiles() {
  if (!room) return useCall.setState({ tiles: [] });
  const local = room.localParticipant;
  const all: Participant[] = [local, ...room.remoteParticipants.values()];
  const tiles: Tile[] = [];
  for (const p of all) {
    const base = { identity: p.identity, name: p.name || p.identity, local: p === local };
    const cam = p.getTrackPublication(Track.Source.Camera);
    tiles.push({ ...base, key: `${p.identity}:person`, kind: 'person', speaking: p.isSpeaking, track: cam && !cam.isMuted ? cam.track : undefined });
    const share = p.getTrackPublication(Track.Source.ScreenShare);
    const screen = share && !share.isMuted ? share.track : undefined;
    if (screen) tiles.push({ ...base, key: `${p.identity}:screen`, kind: 'screen', speaking: false, track: screen });
  }
  useCall.setState({ tiles });
}

function sendState() {
  const { muted, deafened, video, screen } = useCall.getState();
  socket?.emit('voice:update', { muted, deafened, video, streaming: screen });
}

export async function joinCall(channelId: string) {
  if (useCall.getState().channelId === channelId) return;
  await leaveCall();
  useCall.setState({ channelId, connecting: true, error: null, video: false, screen: false });
  try {
    const { url, token, canSpeak } = await api<{ url: string; token: string; canSpeak: boolean }>(`/channels/${channelId}/voice`, { method: 'POST' });
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
      publishDefaults: {
        audioPreset: AudioPresets.musicHighQuality,
        dtx: true,
        red: true,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        screenShareEncoding: ScreenSharePresets.h1080fps30.encoding,
      },
    });
    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.muted = useCall.getState().deafened;
          audioEls.set(`${participant.identity}:${track.sid}`, el);
          document.body.appendChild(el);
        }
        syncTiles();
      })
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        const key = `${participant.identity}:${track.sid}`;
        audioEls.get(key)?.remove();
        audioEls.delete(key);
        track.detach();
        syncTiles();
      })
      .on(RoomEvent.ParticipantConnected, syncTiles)
      .on(RoomEvent.ParticipantDisconnected, syncTiles)
      .on(RoomEvent.LocalTrackPublished, syncTiles)
      .on(RoomEvent.TrackMuted, syncTiles)
      .on(RoomEvent.TrackUnmuted, syncTiles)
      .on(RoomEvent.LocalTrackUnpublished, () => { useCall.setState({ screen: !!room?.localParticipant.isScreenShareEnabled }); sendState(); syncTiles(); })
      .on(RoomEvent.ActiveSpeakersChanged, syncTiles)
      .on(RoomEvent.Disconnected, () => { if (room) void leaveCall(); });
    await room.connect(url, token);
    useCall.setState({ connecting: false });
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
  for (const el of audioEls.values()) el.remove();
  audioEls.clear();
  if (r) await r.disconnect();
  if (useCall.getState().channelId) {
    socket?.emit('voice:leave');
    await api('/voice', { method: 'DELETE' }).catch(() => {});
  }
  useCall.setState((s) => ({ channelId: null, connecting: false, tiles: [], video: false, screen: false, error: keepError ? s.error : null }));
}

export async function toggleMute() {
  const muted = !useCall.getState().muted;
  useCall.setState({ muted });
  await room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => useCall.setState({ muted: true }));
  sendState();
}

export function toggleDeafen() {
  const deafened = !useCall.getState().deafened;
  useCall.setState({ deafened });
  for (const el of audioEls.values()) el.muted = deafened;
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

export async function toggleScreen() {
  if (!room) return;
  const screen = !useCall.getState().screen;
  try {
    await room.localParticipant.setScreenShareEnabled(screen, {
      audio: true,
      resolution: ScreenSharePresets.h1080fps30.resolution,
      contentHint: 'detail',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
    useCall.setState({ screen });
  } catch { /* user cancelled the picker */ }
  sendState();
  syncTiles();
}
