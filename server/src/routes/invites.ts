import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { one, query } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { forbidden, HttpError, notFound } from '../errors.js';
import { P, requireServer } from '../permissions.js';
import { emitToServer, emitToUser, setServerSubscription } from '../realtime.js';
import { getPublicUser } from '../serializers.js';
import { memberPayload, serverSnapshot } from './servers.js';

export const invitesRouter = Router();
invitesRouter.use(requireAuth);

const newCode = () => randomBytes(6).toString('base64url');

async function invitePayload(inv: any) {
  const server = await one('SELECT id, name, icon_url FROM servers WHERE id = $1', [inv.server_id]);
  const count = await one<{ n: number }>('SELECT count(*)::int AS n FROM members WHERE server_id = $1', [inv.server_id]);
  return {
    code: inv.code,
    server: { id: server.id, name: server.name, iconUrl: server.icon_url, memberCount: count!.n },
    inviter: await getPublicUser(inv.inviter_id),
    uses: inv.uses,
    maxUses: inv.max_uses,
    expiresAt: inv.expires_at,
  };
}

const isUsable = (inv: any) => (!inv.expires_at || new Date(inv.expires_at) > new Date()) && (!inv.max_uses || inv.uses < inv.max_uses);

invitesRouter.post('/servers/:serverId/invites', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.CREATE_INVITE);
  const body = z.object({
    maxUses: z.number().int().min(1).max(1000).nullable().optional(),
    maxAgeSeconds: z.number().int().min(0).max(30 * 86400).default(7 * 86400),
  }).parse(req.body ?? {});
  const inv = await one(
    'INSERT INTO invites (code, server_id, inviter_id, max_uses, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [newCode(), serverId, uid(req), body.maxUses ?? null, body.maxAgeSeconds ? new Date(Date.now() + body.maxAgeSeconds * 1000) : null]);
  res.status(201).json(await invitePayload(inv));
});

invitesRouter.get('/servers/:serverId/invites', async (req, res) => {
  const serverId = String(req.params.serverId);
  await requireServer(serverId, uid(req), P.MANAGE_SERVER);
  const rows = await query('SELECT * FROM invites WHERE server_id = $1 ORDER BY created_at DESC', [serverId]);
  res.json(await Promise.all(rows.filter(isUsable).map(invitePayload)));
});

invitesRouter.get('/invites/:code', async (req, res) => {
  const inv = await one('SELECT * FROM invites WHERE code = $1', [req.params.code]);
  if (!inv || !isUsable(inv)) throw notFound('Convite inválido ou expirado');
  res.json(await invitePayload(inv));
});

invitesRouter.post('/invites/:code', async (req, res) => {
  const inv = await one('SELECT * FROM invites WHERE code = $1', [req.params.code]);
  if (!inv || !isUsable(inv)) throw notFound('Convite inválido ou expirado');
  if (await one('SELECT 1 FROM bans WHERE server_id = $1 AND user_id = $2', [inv.server_id, uid(req)])) throw forbidden('Você foi banido deste servidor');
  const already = await one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [inv.server_id, uid(req)]);
  if (!already) {
    const joined = await one(
      `WITH claim AS (UPDATE invites SET uses = uses + 1 WHERE code = $1 AND (max_uses IS NULL OR uses < max_uses) RETURNING server_id)
       INSERT INTO members (server_id, user_id) SELECT server_id, $2 FROM claim RETURNING 1`, [inv.code, uid(req)]);
    if (!joined) throw new HttpError(410, 'Convite esgotado');
    emitToServer(inv.server_id, 'member:add', await memberPayload(inv.server_id, uid(req)));
    setServerSubscription(uid(req), inv.server_id, true);
  }
  const snapshot = await serverSnapshot(inv.server_id, uid(req));
  if (!already) emitToUser(uid(req), 'server:create', snapshot);
  res.json(snapshot);
});

invitesRouter.delete('/invites/:code', async (req, res) => {
  const inv = await one('SELECT * FROM invites WHERE code = $1', [req.params.code]);
  if (!inv) throw notFound('Convite não encontrado');
  if (inv.inviter_id !== uid(req)) await requireServer(inv.server_id, uid(req), P.MANAGE_SERVER);
  await one('DELETE FROM invites WHERE code = $1', [inv.code]);
  res.status(204).end();
});
