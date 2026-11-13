import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Builds the command-line tool (dist/cli.js) and the core library (dist/core/index.js).
// Vite is used instead of plain tsc because the core takes docs/default-style-guide.md in as text.
export default defineConfig({
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { cli: resolve('src/cli.ts'), 'core/index': resolve('src/core/index.ts') },
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
