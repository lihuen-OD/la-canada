# Frontend — La Cañada

React 19 + TypeScript + Vite + `react-router-dom`. Ver el `README.md` de la raíz para instalación/ejecución del monorepo completo; este archivo documenta específicamente lo que vive en `frontend/`.

## Estado actual (Etapa 3C)

Implementado: el flujo completo de autenticación por selección de identidad + PIN, conectado al backend real. **No implementado todavía**: dashboard ni ningún módulo de negocio (real ni mock) — eso es la Etapa 4 (ver `docs/MIGRATION_PLAN.md`, raíz del repo).

## Estructura

```text
src/
├── api/               Cliente HTTP genérico (httpClient.ts) + wrappers de endpoints (authApi.ts) + tipos (types.ts)
├── auth/               Estado de autenticación: accessTokenStore (token en memoria), refreshCoordinator
│                       (single-flight de /auth/refresh), authContext/AuthProvider/useAuth
├── components/         Pantallas de estado global (carga inicial, error de restauración de sesión)
├── features/
│   ├── auth/           Selector de identidad, teclado de PIN, pantalla de login
│   └── home/           Área autenticada temporal (punto de entrada, no el dashboard definitivo)
├── routes/             AppRoutes, ProtectedRoute, RequireRole (preparado, sin consumidor real todavía)
├── styles/              global.css — paleta y tipografía nuevas, ver nota más abajo
└── test/                setup.ts (Testing Library + jest-dom)
```

## Cómo se conecta con el backend

Todas las requests usan rutas **relativas** bajo `/api` (`src/api/httpClient.ts`) — nunca una URL absoluta, nunca una variable `VITE_*`. Esto se resuelve distinto según el entorno:

- **Desarrollo**: `vite.config.ts` define un proxy (`server.proxy['/api'] -> http://localhost:4000`, sin `rewrite` — el prefijo `/api/v1` debe llegar intacto porque el backend monta sus rutas ahí). El puerto de destino coincide con `PORT` en `.env.example`. Con esto, el navegador nunca ve la request como cross-origin: habla con el propio dev server de Vite, que reenvía internamente — la cookie `HttpOnly` del refresh token (`lc_refresh_token`) se setea/envía sin fricción, sin necesitar CORS del lado del navegador.
- **Producción (pendiente — no configurado en esta etapa)**: falta la URL real de Render. Cuando exista, Netlify necesita un archivo de redirects (`public/_redirects` o `netlify.toml` en la raíz) con, como mínimo:

  ```
  /api/*  https://<url-real-de-render>/api/:splat  200
  /*      /index.html                              200
  ```

  **El orden importa**: la regla de `/api/*` tiene que ir *antes* que el catch-all de la SPA. Si se invierte, cualquier request a `/api/...` recibiría el `index.html` de la SPA en vez de llegar al backend, y el frontend interpretaría eso como una respuesta inválida (no como un error de red obvio).

  Además, para que `POST /auth/refresh`/`POST /auth/logout` no fallen con `403 AUTH_ORIGIN_INVALID` (`validateOrigin` en el backend):
  - `FRONTEND_URL` en las variables de entorno de Render debe coincidir **exactamente** con la URL pública real de Netlify.
  - El header `Origin` que manda el navegador se preserva tal cual a través del proxy de Netlify — no hace falta ninguna configuración adicional para eso.

  Verificación pendiente para cuando exista el despliegue real (no se puede probar sin la URL de Render):
  1. `POST /auth/login` exitoso trae un `Set-Cookie` con `HttpOnly`, `Secure`, y `SameSite=None` (dominios cruzados reales entre Netlify y Render).
  2. Un `POST /auth/refresh` posterior manda esa cookie de vuelta y renueva el access token.
  3. `POST /auth/logout` la limpia (nunca debería aparecer en `document.cookie` de todos modos, por ser `HttpOnly`).

  No se decidió todavía si la arquitectura final usa este proxy de Netlify o un dominio propio compartido para frontend+backend — ver `docs/ARCHITECTURE.md`, secciones 14.8 y 15.7, en la raíz del repo.

## Autenticación — decisiones clave

Detalle completo en `docs/ARCHITECTURE.md` (sección 15) y `docs/SECURITY.md`, en la raíz. Resumen:

- El **access token** vive únicamente en memoria (`src/auth/accessTokenStore.ts`) — nunca `localStorage`/`sessionStorage`/`IndexedDB`. Se pierde al recargar la página a propósito.
- El **refresh token** nunca es accesible desde JS — sigue exclusivamente en la cookie `HttpOnly` que ya gestiona el backend.
- Al montar la app, `AuthProvider` intenta un único `POST /auth/refresh` para restaurar la sesión. Un **coordinador single-flight** (`src/auth/refreshCoordinator.ts`) garantiza que, sin importar cuántos disparadores concurrentes haya (doble montaje de efectos de React StrictMode, o varias requests con 401 casi al mismo tiempo), solo se haga **una** llamada HTTP real — necesario porque el backend trata una rotación concurrente de refresh token como posible robo y puede revocar toda la sesión.
- Un logout mientras un refresh sigue en vuelo descarta el resultado tardío — nunca vuelve a autenticar a alguien que ya cerró sesión.
- El PIN nunca se persiste más allá del intento en curso, nunca se muestra en texto plano, nunca se registra en logs.

## Paleta y tipografía — nota importante

`src/styles/global.css` usa una paleta y tipografía **nuevas**, definidas en esta etapa — **no es una reconstrucción del diseño original**. El prototipo real (`index.html`/`legacy/index.original.html`, con paleta y tipografías Fraunces/Karla) fue retirado del repositorio y de todo el historial de Git en la Etapa 2.3 (ver `AGENTS.md`, regla 9) y no es recuperable desde acá. Reconciliar con el diseño original, si el usuario lo aporta, queda para la Etapa 4.

## Desarrollo

```bash
npm run dev --workspace=frontend      # Vite dev server, http://localhost:5173
npm run build --workspace=frontend    # typecheck + build de producción -> dist/
npm run test --workspace=frontend     # Vitest + Testing Library
npm run typecheck --workspace=frontend
npm run lint --workspace=frontend     # (compartido en la raíz — ver eslint.config.js)
npm run format:check --workspace=frontend
```

O, desde la raíz del monorepo, `npm run dev`/`npm run build`/`npm run test`/etc. corren en ambos workspaces a la vez.

## Tests

Vitest + `@testing-library/react` + `@testing-library/user-event`, mismo estilo que ya usaba el resto del proyecto (`describe`/`it` en español, mocks vía `vi.mock`/`vi.stubGlobal`). Cobertura relevante de esta etapa: estados del selector de identidad (carga/vacío/error/cargado), teclado de PIN (pantalla y físico, incluido el cero inicial), prevención de doble envío, ausencia de `localStorage`/`sessionStorage`, single-flight de refresh bajo concurrencia real (incluido un test con `<StrictMode>` real), reintento único tras 401 sin loops, logout durante un refresh en vuelo, rutas protegidas.
