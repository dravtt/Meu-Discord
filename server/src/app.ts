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
  for (const router of [authRouter, relationshipsRouter, serversRouter, channelsRouter, messagesRouter, dmsRouter, invitesRouter, voiceRouter, uploadsRouter, soundboardRouter, gamesRouter]) {
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
