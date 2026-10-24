import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL', 'postgres://nexo:nexo@localhost:5432/nexo'),
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-secret'),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  livekit: {
    url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY ?? 'devkey',
    apiSecret: process.env.LIVEKIT_API_SECRET ?? 'secret',
  },
  /** Address friends use (e.g. https://voka.app.br). Invite links use it; if empty, the last public address seen (a tunnel). */
  publicUrl: (process.env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Proxies whose X-Forwarded-For we believe (Caddy in Docker, cloudflared on this PC), so rate limits see the real visitor IP. */
  trustProxy: process.env.TRUST_PROXY ?? 'loopback, uniquelocal',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  webDist: process.env.WEB_DIST ?? '../web/dist',
  maxUploadBytes: 80 * 1024 * 1024,
  maxServersPerUser: Number(process.env.MAX_SERVERS_PER_USER ?? 100),
  /** e.g. smtps://seuemail%40gmail.com:senha-de-app@smtp.gmail.com:465 */
  smtpUrl: process.env.SMTP_URL ?? '',
  /** Usernames that can see reports and ban accounts. Empty: the first account created is the admin. */
  /** While the beta is open, new accounts get the Beta badge. Turn off with NEXO_BETA=off when the beta ends. */
  betaOpen: process.env.NEXO_BETA !== 'off',
  admins: (process.env.NEXO_ADMINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  mailFrom: process.env.MAIL_FROM ?? 'Voka <no-reply@voka.app>',
  /** Tests turn these off. */
  emailVerification: process.env.NEXO_EMAIL_VERIFY !== 'off',
  checkMx: process.env.NEXO_CHECK_MX !== 'off',
  rateLimits: process.env.NEXO_RATE_LIMITS !== 'off',
};
