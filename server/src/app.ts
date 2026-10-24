import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
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
