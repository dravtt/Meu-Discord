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
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  webDist: process.env.WEB_DIST ?? '../web/dist',
  maxUploadBytes: 25 * 1024 * 1024,
};
