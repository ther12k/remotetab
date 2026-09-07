import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/extension/src/**/*.test.ts',
      'apps/mobile-web/src/**/*.test.ts',
      'apps/mobile-web/src/**/*.test.tsx',
    ],
    exclude: ['**/node_modules/**', 'apps/signaling/**'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
});
