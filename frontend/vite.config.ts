import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  // Lee el .env centralizado en la raíz del monorepo (ver .env.example) en
  // vez del .env local de este workspace — manejo centralizado de variables
  // de entorno para todo el proyecto, compartido con el backend.
  envDir: path.resolve(rootDir, '..'),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
