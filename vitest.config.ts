import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.memory', '.workrepos'],
  },
  resolve: {
    alias: {
      '@root': path.resolve(__dirname, '.'),
      '@adapters': path.resolve(__dirname, './adapters'),
      '@modules': path.resolve(__dirname, './modules'),
      '@local-tools': path.resolve(__dirname, './local-tools'),
      '@common': path.resolve(__dirname, './common'),
    },
  },
});
