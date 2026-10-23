import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NEXO_DISCONNECT_GRACE_MS: '0',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://nexo:nexo@localhost:5432/nexo_test',
      UPLOAD_DIR: './test-uploads',
      JWT_SECRET: 'test-secret',
      NEXO_EMAIL_VERIFY: 'off',
      NEXO_CHECK_MX: 'off',
      NEXO_RATE_LIMITS: 'off',
    },
    fileParallelism: false,
    testTimeout: 15000,
  },
});
