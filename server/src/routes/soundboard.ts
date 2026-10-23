import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { config } from '../config.js';
import { getChannel, has, P, requireServer } from '../permissions.js';
import { emitToChannel, emitToServer, voiceStateOf } from '../realtime.js';

/** Soundboard: short sounds per server that anyone in a call can play for everyone in it. */
export const soundboardRouter = Router();
soundboardRouter.use(requireAuth);

const MAX_SOUNDS = 48;
const MAX_BYTES = 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/mp4', 'audio/x-m4a', 'audio/aac']);
/** Sounds built into the app (synthesized on each device). Kept in sync with web/src/lib/soundboard.ts. */
const BUILTIN = new Set(['buzina', 'tambor', 'palmas', 'grilos', 'trombone', 'pato', 'tada', 'boing', 'suspense', 'sino']);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).slice(0, 8)}`),
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, AUDIO_TYPES.has(file.mimetype)),
});

const serialize = (r: any) => ({ id: r.id, serverId: r.server_id, name: r.name, emoji: r.emoji, url: r.url, volume: r.volume, uploaderId: r.uploader_id });

soundboardRouter.get('/servers/:serverId/sounds', async (req, res) => {
  const serverId = String(req.params.serverId);
  const perms = await requireServer(serverId, uid(req));
  const rows = await query('SELECT * FROM soundboard_sounds WHERE server_id = $1 ORDER BY created_at', [serverId]);
  res.json({ sounds: rows.map(serialize), canManage: has(perms, P.MANAGE_SERVER) });
});

soundboardRouter.post('/servers/:serverId/sounds', upload.single('file'), async (req, res) => {
  const serverId = String(req.params.serverId);
  const discard = () => (req.file ? fs.unlink(req.file.path).catch(() => {}) : undefined);
  try {
    await requireServer(serverId, uid(req));
    if (!req.file) throw badRequest('Envie um áudio MP3, OGG, WAV ou M4A de até 1 MB');
    const body = z.object({
      name: z.string().trim().min(1, 'Dê um nome ao som').max(32),
      emoji: z.string().max(16).default(''),
      volume: z.coerce.number().min(0.05).max(1).default(1),
    }).parse(req.body);
    const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM soundboard_sounds WHERE server_id = $1', [serverId]);
    if (count!.n >= MAX_SOUNDS) throw badRequest(`Este servidor já tem ${MAX_SOUNDS} sons`);
    const row = await one('INSERT INTO soundboard_sounds (server_id, name, emoji, url, volume, uploader_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [serverId, body.name, body.emoji, `/uploads/${req.file.filename}`, body.volume, uid(req)]);
    emitToServer(serverId, 'soundboard:update', { serverId });
    res.status(201).json(serialize(row));
  } catch (e) {
    await discard();
    throw e;
  }
});

soundboardRouter.delete('/servers/:serverId/sounds/:soundId', async (req, res) => {
  const serverId = String(req.params.serverId);
  const perms = await requireServer(serverId, uid(req));
  const sound = await one('SELECT * FROM soundboard_sounds WHERE id = $1 AND server_id = $2', [String(req.params.soundId), serverId]);
  if (!sound) throw notFound('Som não encontrado');
  if (sound.uploader_id !== uid(req) && !has(perms, P.MANAGE_SERVER)) throw forbidden('Só quem enviou o som ou um administrador pode apagar');
  await one('DELETE FROM soundboard_sounds WHERE id = $1', [sound.id]);
  emitToServer(serverId, 'soundboard:update', { serverId });
  res.status(204).end();
});

const lastPlay = new Map<string, number>();

/** Plays a sound for everyone in the caller's current call. */
soundboardRouter.post('/voice/soundboard', async (req, res) => {
  const me = uid(req);
  const body = z.object({ soundId: z.string().uuid().optional(), builtin: z.string().max(32).optional() }).parse(req.body ?? {});
  const state = voiceStateOf(me);
  if (!state) throw badRequest('Entre numa chamada para tocar sons');
  const now = Date.now();
  // Only stops scripted floods; a person clicking fast is never blocked.
  if (now - (lastPlay.get(me) ?? 0) < 100) throw badRequest('Calma! Muitos sons ao mesmo tempo');

  let payload: Record<string, unknown>;
  if (body.soundId) {
    const sound = await one('SELECT * FROM soundboard_sounds WHERE id = $1', [body.soundId]);
    if (!sound) throw notFound('Som não encontrado');
    await requireServer(sound.server_id, me);
    payload = { soundId: sound.id, url: sound.url, volume: sound.volume, name: sound.name, emoji: sound.emoji };
  } else if (body.builtin && BUILTIN.has(body.builtin)) {
    payload = { builtin: body.builtin };
  } else throw badRequest('Escolha um som');

  lastPlay.set(me, now);
  const event = { ...payload, channelId: state.channelId, userId: me };
  if (state.serverId) emitToServer(state.serverId, 'soundboard:play', event);
  else await emitToChannel(await getChannel(state.channelId), 'soundboard:play', event);
  res.status(204).end();
});
