import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/database/auth.postgres.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      ALLOWED_ORIGINS: 'http://localhost:5173',
    },
    hookTimeout: 60_000,
    testTimeout: 15_000,
  },
});
