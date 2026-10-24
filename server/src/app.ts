import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { one } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { relationshipsRouter } from './routes/relationships.js';
import { serversRouter } from './routes/servers.js';
import { channelsRouter } from './routes/channels.js';
import { messagesRouter } from './routes/messages.js';
import { dmsRouter } from './routes/dms.js';
import { invitesRouter } from './routes/invites.js';
import { voiceRouter } from './routes/voice.js';
import { uploadsRouter } from './routes/uploads.js';
import { soundboardRouter } from './routes/soundboard.js';
import { gamesRouter } from './routes/games.js';
import { moderationRouter } from './routes/moderation.js';

// Only quick-tunnel hosts, and only from cloudflared on this machine: Cloudflare routes by Host, so a
// request that came through our tunnel carries our tunnel's name; anything else could be forged.
const TUNNEL_HOST = /^[a-z0-9-]+\.trycloudflare\.com$/;
let lastPublicUrl = '';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/uploads', express.static(path.resolve(config.uploadDir), {
    maxAge: '7d',
    // Uploaded HTML/SVG must not run as part of our origin.
    setHeaders: (res) => { res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"); res.setHeader('X-Content-Type-Options', 'nosniff'); },
  }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Remember the last address people reached us through from outside (e.g. a Cloudflare tunnel), so
  // invite links copied on the host PC (localhost) still work for friends.
  app.use((req, _res, next) => {
    const host = req.get('host') ?? '';
    if (TUNNEL_HOST.test(host) && /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '')) lastPublicUrl = `https://${host}`;
    next();
  });
  // Invite links: a tiny page with link-preview tags (WhatsApp, Instagram, Discord… show the server's
  // name and picture), which then opens the app on the invite.
  app.get('/convite/:code', async (req, res, next) => {
    try {
      const code = String(req.params.code).replace(/[^\w-]/g, '');
      const inv = await one<{ name: string; icon_url: string | null; members: number }>(
        `SELECT s.name, s.icon_url, (SELECT count(*)::int FROM members m WHERE m.server_id = s.id) AS members
         FROM invites i JOIN servers s ON s.id = i.server_id
         WHERE i.code = $1 AND (i.expires_at IS NULL OR i.expires_at > now()) AND (i.max_uses IS NULL OR i.uses < i.max_uses)`, [code]);
      const host = req.get('host') ?? 'localhost';
      const proto = TUNNEL_HOST.test(host) ? 'https' : (req.get('x-forwarded-proto')?.split(',')[0] ?? req.protocol);
      const base = config.publicUrl || `${proto}://${host}`;
      const image = inv?.icon_url ? `${base}${inv.icon_url.startsWith('/') ? '' : '/'}${inv.icon_url}` : `${base}/icon-192.png`;
      const title = inv ? `Convite para ${inv.name}` : 'Convite do Voka';
      const desc = inv ? `Você foi convidado para entrar em ${inv.name} no Voka · ${inv.members} ${inv.members === 1 ? 'membro' : 'membros'}` : 'Este convite expirou ou não existe.';
      const target = `/#/convite/${code}`;
      res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta property="og:type" content="website"><meta property="og:site_name" content="Voka">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:url" content="${esc(`${base}/convite/${code}`)}">
<meta name="twitter:card" content="summary"><meta name="theme-color" content="#7533fb">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body style="background:#0c0913;color:#eee;font-family:sans-serif"><script>location.replace(${JSON.stringify(target)})</script><a href="${esc(target)}">Abrir o convite no Voka</a></body></html>`);
    } catch (e) { next(e); }
  });
  app.get('/api/public-url', (_req, res) => res.json({ url: config.publicUrl || lastPublicUrl }));
  for (const router of [authRouter, relationshipsRouter, serversRouter, channelsRouter, messagesRouter, dmsRouter, invitesRouter, voiceRouter, uploadsRouter, soundboardRouter, gamesRouter, moderationRouter]) {
    app.use('/api', router);
  }
  // In production the API also serves the web build, so web and desktop share one origin.
  const webDist = path.resolve(config.webDist);
  if (existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
