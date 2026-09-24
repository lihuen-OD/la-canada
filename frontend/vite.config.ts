import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Guarda de regresión: ningún `vite build` puede terminar con el build de
 * desarrollo de React. Si el `.env` define `NODE_ENV=development` y se
 * invoca `vite build` directo (sin `scripts/build.mjs`), Vite resolvería
 * `isProduction: false` — acá se corta con un mensaje claro en vez de
 * generar en silencio un bundle de desarrollo.
 */
const requireProductionBuild: Plugin = {
  name: 'la-canada:require-production-build',
  configResolved(config) {
    if (config.command === 'build' && !config.isProduction) {
      throw new Error(
        'El build no quedó en modo producción (NODE_ENV tomado de un .env). ' +
          'Usá `npm run build`, que fija NODE_ENV=production antes de cargar Vite.',
      );
    }
  },
};

export default defineConfig({
  root: rootDir,
  // Lee el .env centralizado en la raíz del monorepo (ver .env.example) en
  // vez del .env local de este workspace — manejo centralizado de variables
  // de entorno para todo el proyecto, compartido con el backend.
  envDir: path.resolve(rootDir, '..'),
  plugins: [react(), requireProductionBuild],
  server: {
    proxy: {
      // Todas las llamadas del frontend usan rutas relativas bajo /api (ver
      // src/api/httpClient.ts) — nunca una URL absoluta del backend, y nunca
      // una variable VITE_* que exponga esa URL al bundle. En dev, Vite
      // redirige /api hacia el backend local (puerto 4000, igual que
      // `PORT` en .env.example). Sin `rewrite`: el prefijo /api/v1 debe
      // llegar intacto, porque el backend monta sus rutas ahí (ver
      // backend/src/app.ts). `changeOrigin: true` reescribe el header Host
      // para que el backend vea la request como si viniera de su propio
      // origen — no afecta al header Origin, que el navegador sigue
      // enviando como el origen real de la página (necesario para que
      // `validateOrigin`/CORS en el backend validen contra FRONTEND_URL).
      //
      // Con este proxy, el navegador nunca ve la request como cross-origin
      // (habla con el propio dev server de Vite) — por eso la cookie
      // HttpOnly del refresh token (`lc_refresh_token`, SameSite=Lax en
      // desarrollo) se setea/envía sin fricción, sin depender de ninguna
      // configuración especial de CORS del lado del navegador.
      //
      // Estrategia equivalente para producción (Netlify → Render): ver
      // "Proxy de Netlify (pendiente)" en frontend/README.md y
      // docs/ARCHITECTURE.md, sección 14.14 — no se decide ni se configura
      // en esta etapa, solo se documenta qué regla habrá que agregar.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
