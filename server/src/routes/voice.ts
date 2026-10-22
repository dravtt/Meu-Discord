import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { requireAuth, uid } from '../auth.js';
import { badRequest } from '../errors.js';
import { config } from '../config.js';
import { has, P, requireChannel } from '../permissions.js';
import { joinVoice, leaveVoice, voiceStatesFor } from '../realtime.js';
import { one } from '../db.js';

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

/**
 * Joins a voice channel (or a DM call): records the voice state and returns a LiveKit token.
 * The LiveKit room name is the channel id; publish rights follow SPEAK / VIDEO.
 */
voiceRouter.post('/channels/:channelId/voice', async (req, res) => {
  const { channel, perms } = await requireChannel(String(req.params.channelId), uid(req), P.CONNECT);
  if (!['voice', 'dm', 'group_dm'].includes(channel.type)) throw badRequest('Este canal não tem voz');
  const user = await one('SELECT username, display_name FROM users WHERE id = $1', [uid(req)]);
  const canSpeak = has(perms, P.SPEAK);

  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: uid(req),
    name: user.display_name,
    ttl: '6h',
  });
  token.addGrant({
    room: channel.id,
    roomJoin: true,
    canSubscribe: true,
    canPublish: canSpeak || has(perms, P.VIDEO),
    canPublishData: true,
  });

  joinVoice({ userId: uid(req), channelId: channel.id, serverId: channel.server_id, muted: !canSpeak, deafened: false, video: false, streaming: false });
  res.json({ url: config.livekit.url, token: await token.toJwt(), canSpeak, canVideo: has(perms, P.VIDEO), participants: voiceStatesFor(channel.id) });
});

voiceRouter.delete('/voice', (req, res) => {
  leaveVoice(uid(req));
  res.status(204).end();
});
