import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';

/** Game search for the profile mural, backed by Steam's public store search (no key needed). */
export const gamesRouter = Router();

const STORE = process.env.NEXO_STEAM_STORE ?? 'https://store.steampowered.com';
const cache = new Map<string, { at: number; games: { steamId: number; name: string }[] }>();
const CACHE_MS = 6 * 60 * 60 * 1000;

gamesRouter.get('/games/search', requireAuth, async (req, res) => {
  const q = z.string().trim().min(2).max(60).parse(req.query.q).toLowerCase();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < CACHE_MS) return void res.json({ games: hit.games });
  let games: { steamId: number; name: string }[] = [];
  try {
    const r = await fetch(`${STORE}/api/storesearch/?term=${encodeURIComponent(q)}&l=portuguese&cc=BR`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`steam ${r.status}`);
    const data = await r.json() as { items?: { type?: string; id?: number; name?: string }[] };
    games = (data.items ?? [])
      .filter((i) => i.type === 'app' && Number.isInteger(i.id) && typeof i.name === 'string')
      .slice(0, 8)
      .map((i) => ({ steamId: i.id!, name: i.name!.replace(/[®™]/g, '').trim().slice(0, 60) }));
  } catch {
    // Steam unreachable: the person can still add the game by name and upload a cover.
    return void res.json({ games: [], unavailable: true });
  }
  if (cache.size > 500) cache.clear();
  cache.set(q, { at: Date.now(), games });
  res.json({ games });
});
