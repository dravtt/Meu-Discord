import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://nexo:nexo@localhost:5432/nexo_test',
      UPLOAD_DIR: './test-uploads',
      JWT_SECRET: 'test-secret',
    },
    fileParallelism: false,
    testTimeout: 15000,
  },
});
