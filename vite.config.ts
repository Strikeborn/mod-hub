import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          startup(['.', '--no-sandbox']);
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            // Vite 8 uses rolldownOptions (rollupOptions is ignored unless converted).
            rolldownOptions: {
              platform: 'node',
              external: (id: string) => {
                if (id === 'electron' || id.startsWith('node:')) return true;
                if (id.startsWith('.') || path.isAbsolute(id)) return false;
                return true;
              },
              output: {
                entryFileNames: '[name].js',
              },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        onstart({ startup, reload }) {
          const proc = process as NodeJS.Process & { electronApp?: unknown };
          if (proc.electronApp) reload();
          else startup(['.', '--no-sandbox']);
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.join(rootDir, 'shared'),
    },
  },
});
