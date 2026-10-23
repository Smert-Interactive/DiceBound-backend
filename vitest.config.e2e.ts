import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite(),
  ],

  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],

    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL:
        'postgresql://test:test@127.0.0.1:5432/dicebound_test',
    },
  },
});