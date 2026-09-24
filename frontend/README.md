# Frontend — La Cañada

React 19 + TypeScript + Vite + `react-router-dom`. Ver el `README.md` de la raíz para instalación/ejecución del monorepo completo; este archivo documenta específicamente lo que vive en `frontend/`.

## Estado actual (Etapas 3C/3D/3E)

Implementado: el flujo completo de autenticación por selección de identidad + PIN (Etapa 3C), conectado al backend real, la administración de usuarios en `/admin/users` (Etapa 3D — listar, activar con PIN, cambiar PIN, cambiar estado, todo exclusivo de `ADMIN`), y la reconciliación visual de todas esas pantallas con la identidad original documentada en `docs/UI_CONTEXT.md` (Etapa 3E — tokens, fuentes locales, componentes compartidos, app shell). **No implementado todavía**: dashboard ni ningún módulo de negocio (real ni mock) — ver `docs/MIGRATION_PLAN.md`, raíz del repo.

## Estructura

```text
src/
├── api/               Cliente HTTP genérico (httpClient.ts) + wrappers de endpoints (authApi.ts, adminApi.ts, tasksApi.ts) + tipos (types.ts, adminTypes.ts, taskTypes.ts)
├── app/                AppProviders + AppShell (header, navegación inferior/sidebar, contenido — Etapa 3E)
├── auth/               Estado de autenticación: accessTokenStore (token en memoria), refreshCoordinator
│                       (single-flight de /auth/refresh), authContext/AuthProvider/useAuth, userDisplay (nombre/rol visibles)
├── components/
│   ├── ui/              Primitivas compartidas (Etapa 3E): Button (+ buttonStyles), Card, Badge, Avatar, Modal,
│   │                     StateMessage (EmptyState/ErrorState/LoadingState), PageHeader, Brand, Spinner, icons
│   └── *.tsx            Pantallas de estado global: restauración de sesión y error de conectividad
├── features/
│   ├── admin/           Administración de usuarios (Etapa 3D): AdminUsersScreen, AdminUserRow, PinDialog,
│   │                     ConfirmDialog, AccessDeniedScreen, userStatusTransitions (espejo de la matriz real del backend)
│   ├── auth/            Selector de identidad, teclado de PIN, pantalla de login, LogoutButton
│   ├── tasks/           ✅ Tareas (Etapa 4A): TasksScreen, filtros, TaskItem, diálogos de alta/edición,
│   │                     completado (ADMIN) y reversión, TaskHistory
│   └── home/            Inicio autenticado TEMPORAL (no el Inicio definitivo) — con acceso a Usuarios solo para ADMIN
├── routes/             AppRoutes, ProtectedRoute, RequireRole, navigation.ts (única fuente de rutas/roles/menú)
├── styles/              tokens.css + base/components/app-shell/auth/home/admin.css, entrada única global.css
├── utils/               color.ts (validación de colorHex con fallback neutro)
└── test/                setup.ts (Testing Library + jest-dom) + fixtures/ (datos SINTÉTICOS solo para tests; ningún archivo de runtime puede importarlos — lo verifica styles.test.ts)
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

## Administración de usuarios (Etapa 3D)

`/admin/users`, protegida simultáneamente por `ProtectedRoute` (autenticado) y `RequireRole role="ADMIN"` (con `AccessDeniedScreen` como fallback para cualquier otro rol) — el backend vuelve a exigir lo mismo de forma independiente en cada request (`requireAuth` + `requireRole('ADMIN')`), el frontend nunca es la única barrera. Entrada visible únicamente para `ADMIN` desde `AuthenticatedHome` ("Administrar usuarios").

- **Listado real** (`GET /admin/users`, `api/adminApi.ts`): nombre visible, `username` (identificador técnico interno), rol y estado con etiquetas en español, si está vinculado a un `Employee`. Nunca `pinHash`, intentos fallidos, bloqueo, sesiones ni tokens — el backend no los selecciona en este endpoint, así que no hay nada que ocultar del lado del cliente.
- **Activar** (`PENDING_ACTIVATION` → `ACTIVE`, `POST /admin/users/:id/activate`): pide el PIN nuevo y su confirmación (nunca sugerido/generado), los valida como string de 4 dígitos exactos antes de enviar (preserva ceros iniciales), y limpia ambos campos al cancelar, fallar o tener éxito.
- **Cambiar PIN** (`POST /admin/users/:id/reset-pin`): mismo componente de PIN (`features/admin/PinDialog.tsx`), con advertencia explícita de que cierra todas las sesiones activas de esa persona. Nunca pide ni puede mostrar el PIN anterior.
- **Cambiar estado** (`PATCH /admin/users/:id/status`): solo ofrece las transiciones que el backend realmente permite (espejo en `features/admin/userStatusTransitions.ts`, el backend sigue siendo la autoridad — una desincronización accidental de este archivo solo puede resultar en un botón de más que el backend igual rechaza, nunca en una acción indebida aceptada), con confirmación previa (`ConfirmDialog`) indicando si revoca sesiones. Nunca ofrece una transición que dejaría al sistema sin ningún `ADMIN` activo.
- **Cambio sobre la propia cuenta**: si la acción (cambiar el propio PIN, o cambiar el propio estado a uno que revoca sesiones) afecta a la sesión con la que el `ADMIN` está navegando, `AdminUsersScreen` llama al `logout()` ya existente de `AuthProvider` en vez de refrescar la lista — reutiliza el mismo mecanismo de siempre (limpia el token en memoria, incrementa la "época" para que un refresh tardío no vuelva a autenticar, redirige a login), sin ningún código nuevo para esto.
- **Componente de PIN reutilizable** (`PinDialog.tsx`, dentro de `components/ui/Modal.tsx` — movido ahí en la Etapa 3E): foco inicial y contenido dentro del diálogo, Escape para cerrar (bloqueado mientras se envía), `input type="password" inputMode="numeric" pattern="\d*" autoComplete="one-time-code"` — nunca `type="number"` (convertiría el PIN a número y perdería ceros iniciales) y `autoComplete="one-time-code"` evita que el navegador lo trate como una contraseña guardable. Mensajes de estado con `aria-live`.

## Tareas (Etapa 4A)

`/tasks`, para todo usuario autenticado (✅ Tareas en la navegación). Detalle y contrato en `docs/ARCHITECTURE.md` §18.

- **Datos**: `GET /tasks` + `GET /tasks/employees` al entrar; filtros por persona (chips con avatar y pendientes) y frecuencia sobre la lista cargada; `GET /tasks/history` aparte, con la persona elegida. Sin librería de data fetching.
- **Sin optimismo**: cada operación espera la respuesta real y vuelve a pedir la lista; doble envío bloqueado con guardas síncronas (`useSubmitGuard` y un set de tareas en curso).
- **Roles en la UI** (el backend decide igual): un `EMPLOYEE` completa sin diálogo y nunca envía ejecutor; un `ADMIN` elige el ejecutor entre empleados activos reales, ve crear/editar/desactivar y "Incluir desactivadas y únicas ya completadas".
- **Deshacer**: nunca un toggle; siempre confirma, explica que queda auditado y pide motivo solo si el backend lo exige (ADMIN). Solo se ofrece si `canRevert` (calculado en backend).
- **Emojis del prototipo** (✅, 🚨, 📅, 👤) siempre `aria-hidden` junto a texto real.
- **Sesión vencida**: un 401 que sobrevive al refresh-y-reintento de `httpClient` llama al `logout()` existente.
- **Fechas**: el frontend solo formatea (`completedAt` en la zona que informa la API); nunca calcula períodos.

## Sistema visual (Etapa 3E)

La fuente de verdad visual es `docs/UI_CONTEXT.md` (raíz del repo). Esta sección documenta cómo quedó implementada, sin repetir esa guía.

- **Tokens** (`src/styles/tokens.css`): paleta original exacta (`--forest-*`, `--cream-*`, `--ink-*`, `--earth-*`, estados), tokens semánticos (`--color-bg`, `--color-surface`, `--color-text-muted`, `--color-action`, `--color-positive`/`warning`/`danger`/`info`…), tipografía, espaciado (escala de 4px), radios (16px tarjetas, 10px controles, 22px bottom sheet), sombras, alturas (44px táctil, header 54px, nav 66px, sidebar 210px, contenido ≤1200px, modal 460px), capas (z-index) y movimiento (150/200/250ms). Es el **único** archivo con colores literales — `src/styles/styles.test.ts` falla si aparece un hex/rgb en otra hoja o en un componente. Tres variantes derivadas existen solo para contraste AA (ver `docs/UI_CONTEXT.md`, "Aclaraciones de contraste"). `.theme-inverse` redefine los mismos tokens semánticos para superficies sobre verde bosque (login, header, navegación), así los componentes no necesitan variantes "oscuras" duplicadas.
- **Breakpoints**: 600px (modal centrado en vez de bottom sheet; header con rol y texto de "Cerrar sesión"), 900px (sidebar de escritorio en vez de navegación inferior). El listado administrativo usa *container queries* (grilla de 2 tarjetas desde 560px de contenedor, filas tipo tabla desde 860px) para depender del ancho real disponible, con o sin sidebar.
- **Fuentes**: `@fontsource/fraunces` y `@fontsource/karla` (dependencias del workspace), importadas en `global.css` — solo subset latin (cubre español) y solo los pesos usados: Fraunces 600 normal/itálica, Karla 400/600/700. Se empaquetan como assets locales (~81 kB en woff2 en total; el navegador baja solo las caras que usa); ninguna petición a Google Fonts en runtime.
- **Componentes compartidos** (`src/components/ui/`): `Button` (primario/secundario/destructivo/fantasma, `loading` que deshabilita sin cambiar el nombre accesible, alto mínimo 44px; `buttonClassName` para estilizar un `<Link>` como botón), `Card`, `Badge` (el texto es obligatorio por tipo), `Avatar` (inicial + color validado o escudo para la cuenta admin; siempre decorativo), `Modal` (bottom sheet/centrado, portal, foco contenido, Escape bloqueado al enviar, foco devuelto al cerrar, scroll de fondo bloqueado, sin cierre por click en el overlay), `EmptyState`/`ErrorState`/`LoadingState`, `PageHeader` (único `<h1>` de cada pantalla), `Brand`, iconos SVG propios (sin dependencia).
- **App shell** (`src/app/AppShell.tsx`, ruta de layout dentro de `ProtectedRoute`): header verde bosque con marca, identidad discreta y "Cerrar sesión"; un único `<nav>` que en móvil es barra inferior (con safe areas) y en escritorio sidebar; `<main>` con enlace "Saltar al contenido". Los destinos salen de `src/routes/navigation.ts` (`APP_ROUTES`), la misma configuración que `AppRoutes` usa para declarar la ruta y su rol requerido — hoy solo Inicio y Usuarios (este último solo para `ADMIN`); nunca se muestran módulos futuros.
- **Pantallas alineadas**: restauración de sesión y error de conectividad (mismo fondo verde que el login, sin salto de color), selector de identidad, ingreso de PIN (teclado de 3 columnas con "Limpiar · 0 · Borrar", 4 indicadores idénticos), estados de carga/vacío/error, Inicio temporal, acceso denegado, administración de usuarios (tarjetas en móvil, tabla en escritorio), diálogos de activación, cambio de PIN y cambio de estado.
- **Límites de validación**: jsdom no aplica CSS (`css: false`), así que los tests verifican semántica y comportamiento, más guardas estructurales sobre el código de estilos; no hay axe ni pruebas de regresión visual por píxel. La revisión visual se hizo con Chrome headless por DevTools Protocol (login y PIN contra el backend real; Inicio/Usuarios/modales con respuestas sintéticas interceptadas en ese navegador, sin tocar backend ni base) y requiere además aprobación humana.

## Build de producción

`npm run build` = typecheck + `node scripts/build.mjs`, que fija `NODE_ENV=production` antes de cargar Vite: el `.env` de la raíz puede definir `NODE_ENV=development` (lo usa el backend) y Vite lo aplicaría al build, generando el build de desarrollo de React. No invocar `vite build` directo: si el resultado no es de producción, una guarda en `vite.config.ts` corta el build con un mensaje claro. Regresión cubierta por `src/test/productionBuild.test.ts`. Detalle en `docs/ARCHITECTURE.md` §17.2.

## Desarrollo

```bash
npm run dev --workspace=frontend      # Vite dev server, http://localhost:5173
npm run build --workspace=frontend    # typecheck + build de producción (siempre NODE_ENV=production) -> dist/
npm run test --workspace=frontend     # Vitest + Testing Library
npm run typecheck --workspace=frontend
npm run lint --workspace=frontend     # (compartido en la raíz — ver eslint.config.js)
npm run format:check --workspace=frontend
```

O, desde la raíz del monorepo, `npm run dev`/`npm run build`/`npm run test`/etc. corren en ambos workspaces a la vez.

## Tests

Vitest + `@testing-library/react` + `@testing-library/user-event`, mismo estilo que ya usaba el resto del proyecto (`describe`/`it` en español, mocks vía `vi.mock`/`vi.stubGlobal`). Cobertura de la Etapa 3C: estados del selector de identidad (carga/vacío/error/cargado), teclado de PIN (pantalla y físico, incluido el cero inicial), prevención de doble envío, ausencia de `localStorage`/`sessionStorage`, single-flight de refresh bajo concurrencia real (incluido un test con `<StrictMode>` real), reintento único tras 401 sin loops, logout durante un refresh en vuelo, rutas protegidas. Cobertura nueva de la Etapa 3D (`/admin/users`): acceso exclusivo de `ADMIN` (anónimo → login, `EMPLOYEE` → acceso denegado), listado real sin datos inventados, estados de pantalla (carga/vacío/error con reintento), activación con validación de 4 dígitos exactos y preservación del cero inicial, coincidencia de PIN/confirmación, doble envío bloqueado, limpieza de PIN al cancelar/fallar, advertencia de revocación de sesiones en el cambio de PIN, transiciones de estado limitadas a las que el backend permite, auto-bloqueo nunca ofrecido, cambio sobre la propia cuenta terminando en `logout()` en vez de refrescar la lista, accesibilidad del diálogo (foco inicial, Escape, `aria-live`).

Cobertura nueva de la Etapa 3E: app shell (solo destinos implementados, Usuarios únicamente para `ADMIN`, `aria-current` en el destino activo, landmarks), rutas futuras redirigidas, acceso denegado con salida segura, selector con una/varias identidades, nombres largos y `colorHex` inválido, teclado navegable por Tab y con ceros iniciales, PIN nunca presente en el DOM, `Modal` (foco contenido, Escape, foco restaurado, bloqueo durante el envío), badges con texto, estructura semántica del listado, Inicio sin cifras ni datos de negocio, y guardas de estilos (colores solo en tokens, `prefers-reduced-motion`, fuentes locales, zoom no bloqueado).
