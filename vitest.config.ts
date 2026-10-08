import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@shared': path.join(rootDir, 'shared') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests point USERPROFILE/APPDATA at temp folders; run files one at a time so they don't collide.
    fileParallelism: false,
  },
});
