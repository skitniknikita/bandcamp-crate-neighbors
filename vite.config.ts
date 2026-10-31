import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: { sidepanel: resolve(import.meta.dirname, 'sidepanel.html'), background: resolve(import.meta.dirname, 'src/background.ts'), content: resolve(import.meta.dirname, 'src/content.ts') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
