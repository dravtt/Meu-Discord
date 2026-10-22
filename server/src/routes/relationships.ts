import { Router } from 'express';
import { z } from 'zod';
import { one, query, transaction } from '../db.js';
import { requireAuth, uid } from '../auth.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import { getPublicUser } from '../serializers.js';
import { emitToUser } from '../realtime.js';

/**
 * Friends, requests and blocks. Each side keeps its own row:
 * A->B 'pending' is an outgoing request from A; B sees it as incoming. Accepting makes both rows 'friend'.
 */
export const relationshipsRouter = Router();
relationshipsRouter.use(requireAuth);

async function listFor(userId: string) {
  const outgoing = await query('SELECT target_id AS other, type FROM relationships WHERE user_id = $1', [userId]);
  const incoming = await query("SELECT user_id AS other FROM relationships WHERE target_id = $1 AND type = 'pending'", [userId]);
  const result = [];
  for (const r of outgoing) result.push({ user: await getPublicUser(r.other), type: r.type === 'pending' ? 'outgoing' : r.type });
  for (const r of incoming) {
    if (outgoing.some((o) => o.other === r.other)) continue;
    result.push({ user: await getPublicUser(r.other), type: 'incoming' });
  }
  return result;
}

async function notifyBoth(a: string, b: string) {
  emitToUser(a, 'relationships', await listFor(a));
  emitToUser(b, 'relationships', await listFor(b));
}

relationshipsRouter.get('/relationships', async (req, res) => {
  res.json(await listFor(uid(req)));
});

relationshipsRouter.post('/relationships', async (req, res) => {
  const { username } = z.object({ username: z.string().trim().toLowerCase() }).parse(req.body);
  const target = await one<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
  if (!target) throw notFound('Usuário não encontrado');
  await sendOrAccept(uid(req), target.id);
  res.json(await listFor(uid(req)));
});

relationshipsRouter.put('/relationships/:userId', async (req, res) => {
  await sendOrAccept(uid(req), String(req.params.userId));
  res.json(await listFor(uid(req)));
});

async function sendOrAccept(me: string, other: string) {
  if (me === other) throw badRequest('Você não pode adicionar a si mesmo');
  if (!(await one('SELECT 1 FROM users WHERE id = $1', [other]))) throw notFound('Usuário não encontrado');
  const theirs = await one<{ type: string }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [other, me]);
  if (theirs?.type === 'blocked') throw new HttpError(403, 'Não foi possível enviar o pedido');
  const mine = await one<{ type: string }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [me, other]);
  if (mine?.type === 'friend') return;
  await transaction(async (db) => {
    if (theirs?.type === 'pending') {
      await db.query(`INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 'friend')
                      ON CONFLICT (user_id, target_id) DO UPDATE SET type = 'friend'`, [me, other]);
      await db.query(`UPDATE relationships SET type = 'friend' WHERE user_id = $1 AND target_id = $2`, [other, me]);
    } else {
      await db.query(`INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 'pending')
                      ON CONFLICT (user_id, target_id) DO UPDATE SET type = 'pending'`, [me, other]);
    }
  });
  await notifyBoth(me, other);
}

/** Unfriend, cancel or decline a request, or unblock. */
relationshipsRouter.delete('/relationships/:userId', async (req, res) => {
  const me = uid(req), other = String(req.params.userId);
  await transaction(async (db) => {
    const mine = (await db.query('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [me, other])).rows[0];
    await db.query('DELETE FROM relationships WHERE user_id = $1 AND target_id = $2', [me, other]);
    // Removing a friendship or declining a request removes the other side too; unblocking does not.
    if (mine?.type !== 'blocked') {
      await db.query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND type IN ('friend', 'pending')", [other, me]);
    }
  });
  await notifyBoth(me, other);
  res.status(204).end();
});

relationshipsRouter.post('/relationships/:userId/block', async (req, res) => {
  const me = uid(req), other = String(req.params.userId);
  if (me === other) throw badRequest('Você não pode bloquear a si mesmo');
  await transaction(async (db) => {
    await db.query(`INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 'blocked')
                    ON CONFLICT (user_id, target_id) DO UPDATE SET type = 'blocked'`, [me, other]);
    await db.query("DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND type IN ('friend', 'pending')", [other, me]);
  });
  await notifyBoth(me, other);
  res.json(await listFor(me));
});

export async function isBlockedBetween(a: string, b: string) {
  return !!(await one(
    "SELECT 1 FROM relationships WHERE type = 'blocked' AND ((user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1))", [a, b]));
}
