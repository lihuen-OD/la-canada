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
