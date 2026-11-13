import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/e2e/**', 'tests/renderer/**', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.tsx'],
          setupFiles: ['tests/renderer/setup.ts'],
        },
      },
    ],
  },
});
