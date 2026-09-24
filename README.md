# La Cañada

Sistema de gestión operativa para la propiedad "La Cañada": tareas del equipo, inventario (casa y jardín), gallinero, mascotas, eventos, novedades, clima y datos del equipo de trabajo.

## Estado actual

El proyecto está en transición desde un prototipo de un único archivo (`index.html`, HTML + CSS + JS embebido, conectado directamente a Supabase) hacia una aplicación profesional full stack.

- **`index.html`/`legacy/index.original.html` (el prototipo original) fueron retirados del repositorio.** Contenían una URL y una API key reales de Supabase hardcodeadas en texto plano (ver `docs/SECURITY.md`); una vez confirmado que todo su contenido funcional, visual y de datos ya estaba migrado a `docs/`, al modelo Prisma y al seed, se eliminaron del árbol de trabajo **y de todo el historial de Git** (Etapa 2.3 — ver `docs/MIGRATION_PLAN.md`). La referencia de diseño y comportamiento del prototipo vive ahora exclusivamente en `docs/` (`PROJECT_CONTEXT.md`, `BUSINESS_RULES.md`, `DATABASE.md`, `DATA_INVENTORY.md`).
- **Identidad visual (Etapa 3E)**: las pantallas existentes (login, PIN, Inicio temporal, administración de usuarios, diálogos, estados) están reconciliadas con el diseño original documentado en `docs/UI_CONTEXT.md` — tokens CSS, fuentes Fraunces/Karla empaquetadas localmente, componentes compartidos y app shell responsive. Ver `frontend/README.md`, "Sistema visual".
- **Módulo Tareas (Etapa 4A)**: primer módulo de negocio real, conectado a `demo` — listado con filtros por persona y frecuencia, alta/edición/desactivación (solo `ADMIN`), completar registrando responsable asignado (snapshot) y quién la hizo, reversión sin borrado y auditada, historial semanal. Períodos calculados solo en el backend con la zona `BUSINESS_TIME_ZONE` (Argentina por defecto). Ver `docs/ARCHITECTURE.md` §18.
- **Desempeño (Etapa 4B)**: `/tasks/performance` consume `/api/v1/performance`; usa planificación histórica, cumplimiento ponderado, trabajo realizado, coberturas y racha diaria. Urgentes/únicas se informan fuera del denominador y el rango se limita a 90 días.
- **Stock backend (Etapa 5A, sin frontend todavía)**: `/api/v1/stock` expone catálogo e historial autenticados; `ADMIN` administra categorías/productos y registra ajustes; cualquier usuario autenticado registra ingresos/consumos. Saldo, movimiento y auditoría se escriben en una transacción con actualización decimal atómica. Ver `docs/ARCHITECTURE.md` §20.
- **Todavía no hay dashboard ni frontend de Stock u otros módulos nuevos** (ni reales ni mock). Lo ya implementado en frontend comprende autenticación, usuarios, Tareas y Desempeño.
- **El modelo de datos ya está migrado contra Neon, rama `demo` exclusivamente** (Etapa 3A, con ajustes de `Session`/`User` en 3B.1/3B.2): `backend/prisma/schema.prisma` (22 modelos, 11 enums), migraciones aplicadas, y el seed ya ejecutado dos veces (idempotencia confirmada). `production` no se toca en esta etapa — ver "Base de datos (Prisma + Neon)" más abajo.
- **Autenticación real de punta a punta**: backend (Etapa 3B.1, modelo de credenciales corregido a PIN en 3B.2) + frontend (Etapa 3C). Selección de identidad (`GET /auth/login-options`) + PIN de 4 dígitos, access token en memoria, refresh con rotación (token opaco, nunca un JWT) y single-flight real, logout, `/me`, administración de usuarios (activar con PIN, `reset-pin`, cambiar estado), bloqueo persistente por intentos fallidos, rutas protegidas. `login-options` ya no está vacío: muestra al administrador activo de `demo` (ver punto siguiente). Los 4 empleados reales siguen `PENDING_ACTIVATION`, sin PIN, salvo que un administrador los active manualmente desde `/admin/users`.
- **Administración de usuarios en el frontend (Etapa 3D)**: pantalla `/admin/users`, exclusiva de `ADMIN` (protegida por rol en backend y frontend), para listar los usuarios reales, activar a un `PENDING_ACTIVATION` asignándole su primer PIN, cambiar el PIN de un usuario activo, y suspender/reactivar/deshabilitar respetando exactamente las transiciones que el backend permite — sin poder autobloquear al sistema sin ningún `ADMIN` activo. Cambiar el propio PIN o cambiar el propio estado a uno que revoca sesiones cierra la sesión local igual que un logout normal. **Primer administrador de `demo` ya creado**: el usuario ejecutó personalmente el bootstrap interactivo (`npm run auth:bootstrap-admin`) — existe un `ADMIN` activo y no se vuelve a ejecutar (el propio script se niega si ya hay uno). Ver `docs/MIGRATION_PLAN.md`, "Etapa 3D".
- **Los datos reales** (personas, tareas, stock, catálogos, etc.) ya están cargados en `demo`, exactamente como los describe `docs/SEED_MANIFEST.md` (61 entidades maestras + 14 movimientos de apertura = 75 filas).

Ver `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md` y `docs/MIGRATION_PLAN.md` para el contexto completo y las próximas etapas.

## Arquitectura prevista

| Capa | Tecnología | Despliegue |
|---|---|---|
| Frontend | React + TypeScript + Vite | Netlify |
| Backend | Node.js + TypeScript + Express | Render |
| ORM | Prisma | — |
| Base de datos | PostgreSQL | Neon |
| Fotografías | Neon Object Storage (interfaz S3, buckets privados), vía el backend (nunca directo desde el frontend) | — |

El frontend nunca tiene credenciales de base de datos: toda operación pasa por el backend.

## Estructura del monorepo

```text
/
├── frontend/           React + TypeScript + Vite
├── backend/             Node.js + TypeScript + Express
│   └── prisma/           Schema, config y seed de Prisma (ver sección "Base de datos")
├── docs/                 Documentación técnica y funcional (auditoría del prototipo original, ya retirado — ver "Estado actual")
├── AGENTS.md              Reglas obligatorias de trabajo en este repo
├── package.json           Orquestación del monorepo (npm workspaces)
└── .env.example           Variables de entorno centralizadas (frontend + backend)
```

> El prototipo original (`index.html` en la raíz y `legacy/index.original.html`) ya no existe en este repositorio — ver "Estado actual" más arriba.

## Requisitos locales

- **Node.js 24.x** (Active LTS). El proyecto declara `"engines": { "node": ">=24.0.0" }` en el `package.json` raíz.
- npm 11+ (incluido con Node 24).

## Instalación

```bash
npm install
```

Instala las dependencias de la raíz y de ambos workspaces (`frontend`, `backend`) en un solo paso, gracias a npm workspaces.

## Variables de entorno

Hay un único `.env` centralizado en la raíz del monorepo (no uno por workspace):

```bash
cp .env.example .env
```

- El **backend** lo carga explícitamente desde la raíz (`backend/src/config/index.ts`), sin importar desde qué workspace se ejecute el script.
- El **frontend** (Vite) también lo lee desde la raíz gracias a `envDir` en `frontend/vite.config.ts` — solo las variables prefijadas con `VITE_` llegan al navegador; el resto queda exclusivamente en el backend. **Desde la Etapa 3C, el frontend no necesita ninguna variable `VITE_*`**: habla con el backend por rutas relativas bajo `/api`, resueltas por el proxy de Vite en desarrollo (`frontend/vite.config.ts`) y por el proxy de Netlify en producción (pendiente, ver `frontend/README.md`).

Variables usadas en esta etapa:

| Variable | Usada por | Obligatoria ahora |
|---|---|---|
| `NODE_ENV` | Backend | No (default `development`) |
| `PORT` | Backend | No (default `4000`) — también el destino del proxy de Vite en desarrollo |
| `FRONTEND_URL` | Backend (CORS, `validateOrigin`) | **Sí** — sin ella el backend no arranca. Debe coincidir exactamente con el origen real del frontend (`http://localhost:5173` en desarrollo) |
| `DATABASE_URL` | Backend (runtime, pooled) y seed | **Sí, sin excepción** — el backend no arranca sin ella (falla temprano y con mensaje claro, ver `backend/src/config/env.ts`) |
| `DIRECT_URL` | Prisma Migrate exclusivamente (directa, sin pooler) | Solo para correr migraciones — el servidor nunca la necesita para arrancar |
| `DATABASE_TARGET` | Gate de seguridad de `db:migrate:*`/`db:seed`/`test:integration` (`demo`\|`production`) | Sí, para esos comandos — deben rechazar su ejecución si no es exactamente `demo` |
| `JWT_ACCESS_SECRET` | Backend (firma/verifica el access token, `jose`/HS256) | **Sí, sin excepción** — mínimo 32 caracteres. Generar con `openssl rand -base64 48` y pegarlo solo en el `.env` local (nunca en `.env.example` ni en el código). El backend **no arranca sin ella** (falla temprano y con mensaje claro, misma fuente de verdad que `DATABASE_URL`, ver `backend/src/config/env.ts`) — no es una variable "solo para auth". |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | Backend (segundos) | No — default 720 (12 min) y 2592000 (30 días) si se dejan vacías |
| `COOKIE_SAME_SITE` | Backend (`lax`\|`strict`\|`none`, cookie del refresh token) | No — default `none` en producción (Netlify/Render son dominios distintos), `lax` en desarrollo |
| `BUSINESS_TIME_ZONE` | Backend (zona IANA de los períodos de tareas) | No — default `America/Argentina/Buenos_Aires`; se valida al iniciar (nunca un offset fijo) |

Ninguna de las dos apunta nunca a `production`: esas credenciales, cuando existan, se configuran directamente en Render, nunca en un `.env` de este repositorio (ver `docs/ARCHITECTURE.md`, sección 13).

No existe `JWT_REFRESH_SECRET`: el refresh token es un valor opaco generado con bytes aleatorios (`crypto.randomBytes`), nunca un JWT — no hay nada que firmar del lado del servidor (ver `docs/SECURITY.md`).

Variables previstas para una etapa futura (Object Storage — no se usan todavía, no hace falta completarlas para correr el health check local): `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` (Neon Object Storage, reemplaza a Google Drive — ver `docs/ARCHITECTURE.md`).

Ninguna de estas variables tiene valores reales en `.env.example` ni en el código.

## Ejecución

```bash
# Frontend y backend juntos (concurrently)
npm run dev

# Por separado
npm run dev:frontend   # Vite dev server, http://localhost:5173
npm run dev:backend    # Express con recarga automática, http://localhost:4000
```

Con ambos corriendo, abrir `http://localhost:5173` muestra el flujo de login real (selector de identidad + PIN) — el proxy de Vite (`frontend/vite.config.ts`) reenvía `/api/*` al backend. Con los datos actuales de `demo`, el selector muestra al administrador activo (creado manualmente por el usuario con el bootstrap); los 4 empleados aparecen recién cuando un administrador los activa desde `/admin/users`. Si en otra base no hubiera ningún usuario activo, el selector muestra su estado vacío real ("Todavía no hay usuarios habilitados para ingresar."), sin ningún control para crear un administrador desde el navegador.

## Build

```bash
npm run build
```

Compila (typecheck + bundle) el frontend a `frontend/dist/` y compila el backend a `backend/dist/`.

El bundle del frontend es **siempre** de producción: `npm run build` invoca Vite mediante `frontend/scripts/build.mjs`, que fija `NODE_ENV=production` antes de cargarlo. Es necesario porque el `.env` centralizado puede definir `NODE_ENV=development` para el backend, y Vite aplicaría ese valor al build (generando el build de desarrollo de React, ~518 kB en vez de ~290 kB). Funciona igual en cualquier sistema operativo, sin tocar el `.env`. Un `vite build` invocado directamente en esa condición falla con un mensaje claro (guarda en `frontend/vite.config.ts`), y `frontend/src/test/productionBuild.test.ts` verifica ambas cosas. El backend no cambia: sigue leyendo `NODE_ENV` del `.env` en desarrollo.

## Typecheck, lint, tests, formateo

```bash
npm run typecheck      # tsc --noEmit en ambos workspaces
npm run lint            # ESLint (config compartida en eslint.config.js, raíz)
npm run test             # Vitest en ambos workspaces
npm run format           # Prettier --write (config compartida en .prettierrc, raíz)
npm run format:check     # Prettier --check
```

`docs/` y los archivos Markdown están excluidos de Prettier a propósito (`.prettierignore`) para no reformatear la documentación. (El prototipo original, `index.html`/`legacy/`, tenía la misma exclusión hasta que se retiró del repositorio — ver "Estado actual".)

## Endpoint de health

Con el backend corriendo:

```bash
curl http://localhost:4000/api/v1/health
```

Responde `200` con:

```json
{
  "status": "ok",
  "service": "la-canada-api",
  "environment": "development",
  "timestamp": "2026-09-22T15:11:16.330Z",
  "version": "0.1.0"
}
```

No incluye estado de Neon todavía porque ningún endpoint de negocio usa la base en esta etapa (el módulo de conexión existe, y el servidor ya requiere `DATABASE_URL` para arrancar, pero nada lo llama desde un endpoint HTTP todavía).

## Base de datos (Prisma + Neon)

El modelo de datos (`backend/prisma/schema.prisma`, 22 modelos, 11 enums — ver `docs/DATABASE.md`) ya está migrado contra Neon, rama `demo` exclusivamente (Etapa 3A). `production` no se toca en esta etapa.

Comandos estáticos — **funcionan sin `DATABASE_URL`/`DIRECT_URL`/`DATABASE_TARGET`, incluso sin ningún `.env`** (verificado explícitamente, ver `docs/ARCHITECTURE.md` sección 13.7):

```bash
cd backend
npx prisma format      # formatea prisma/schema.prisma
npx prisma validate    # valida el schema estáticamente
npx prisma generate    # genera el cliente TS en src/generated/prisma/ (también corre solo, vía postinstall)
```

Comandos que sí requieren conexión — usan `DATABASE_URL` (pooled) o `DIRECT_URL` (directa, solo Prisma Migrate) según corresponda (ver `docs/ARCHITECTURE.md`, sección 13):

```bash
npm run db:check           # SELECT 1 de solo lectura — confirma conectividad sin modificar nada
npm run db:migrate:dev     # flujo interactivo de desarrollo (crear + aplicar migraciones)
npm run db:migrate:deploy  # aplica migraciones ya creadas, sin prompts — usado en el proceso controlado de esta etapa
npm run db:migrate:status  # estado de migraciones aplicadas / detecta drift
npm run db:seed            # corre backend/prisma/seed.ts (registrado en prisma.config.ts)
```

`db:migrate:dev`, `db:migrate:deploy`, `db:seed` y `test:integration` exigen además `DATABASE_TARGET=demo` — una guarda (`backend/src/scripts/guardDbCommand.ts`) rechaza la ejecución, antes de invocar Prisma, si el valor no es exactamente `"demo"`, si falta la variable de conexión requerida, o si su forma no coincide con lo esperado (pooled/direct). `db:check`/`db:migrate:status` quedan sin este gate por ser de solo lectura.

`prisma generate` corre automáticamente después de `npm install` (script `postinstall` de `backend/package.json`) — la carpeta generada está en `.gitignore`, no se commitea.

**Migración inicial** (`backend/prisma/migrations/20260922174631_init/`): generada con `--create-only`, revisada a mano, y aplicada con `prisma migrate deploy` — nunca con `db push`. Incluye 5 restricciones `CHECK` agregadas a mano (las únicas filas de la matriz de invariantes de `docs/DATABASE.md` clasificadas para SQL). Detalle completo del proceso y de la verificación posterior en `docs/ARCHITECTURE.md` (sección 13) y `docs/MIGRATION_PLAN.md` ("Etapa 3A").

**Seed** (`backend/prisma/seed.ts` + `backend/prisma/seed-data/`): contiene los datos reales del prototipo (4 empleados, 4 usuarios pendientes de activación, 10 tareas, 14 productos de stock, categorías, novedades, eventos, cumpleaños recurrentes, tipos de mascota — **61 entidades maestras + 14 movimientos de apertura de stock = 75 filas**, manifiesto exacto en `docs/SEED_MANIFEST.md`). Ya se ejecutó dos veces contra `demo`: los conteos coinciden exactamente, y la segunda corrida no duplicó ni modificó nada (idempotencia confirmada contra Postgres real, no solo por lectura del código).

**Cliente Prisma único** (`backend/src/lib/prisma.ts`): una sola instancia reutilizable de `PrismaClient` (vía `@prisma/adapter-pg`, `DATABASE_URL`) — ningún servicio debe crear la suya propia. Sin endpoints que lo usen todavía (eso es de la Etapa 5); el cierre ordenado ya está conectado al apagado del servidor.

**Tests de integración** (`backend/src/test/integration/`, `npm run test:integration`): corren contra Neon real (`demo`) — separados de la suite normal (`npm test`, que nunca requiere conexión), y siempre en secuencia (`fileParallelism: false`, ver `vitest.integration.config.mts`) porque miden conteos globales de filas como línea de base. Prueban que los 5 `CHECK` de la migración inicial realmente rechazan la fila inválida (siempre dentro de una transacción con `ROLLBACK`), y el flujo real de autenticación (login/refresh/rotación/detección de reuso/logout, administración de usuarios, e idempotencia del bootstrap del primer admin) con limpieza determinística — nunca dejan usuarios, sesiones ni auditorías de prueba, y nunca tocan las filas del seed real.

Prisma 7 movió la configuración de conexión fuera de `schema.prisma` a `backend/prisma.config.ts` — ver `docs/ARCHITECTURE.md` §10 para el detalle de este y otros cambios de la versión instalada.

## Autenticación (backend: Etapas 3B.1/3B.2 · frontend: Etapas 3C/3D)

De punta a punta: backend + frontend. Detalle completo en `docs/ARCHITECTURE.md` (secciones 14, 15 y 16), `docs/SECURITY.md` y `frontend/README.md`.

**Backend**:
- **Identidad + PIN, no usuario+contraseña**: la persona selecciona su identidad (`GET /api/v1/auth/login-options`) e ingresa un PIN numérico de 4 dígitos — mismo patrón de acceso que el prototipo original, pero con PIN individual (nunca compartido/predeterminado), hash Argon2id, y bloqueo persistente por intentos fallidos.
- **Access token**: JWT (HS256, vía `jose`), corta duración (default 12 min), claims mínimos (`sub`, `sid`, `role`, `iat`, `exp`), issuer/audience propios.
- **Refresh token**: opaco (no JWT), 256 bits aleatorios, enviado solo por cookie `HttpOnly` (`lc_refresh_token`, `Path=/api/v1/auth`) — en base solo se guarda su hash SHA-256. Rota en cada uso (protegido contra rotación concurrente); reusar un token ya rotado revoca todas las sesiones activas de ese usuario (posible robo).
- **Fuerza bruta**: 5 PIN incorrectos consecutivos bloquean la cuenta 15 minutos (contador y bloqueo persistidos en Postgres, no en memoria — sobreviven a un reinicio de Render), además del rate limit por IP ya existente en `/auth/login`.
- **Endpoints**: `GET /api/v1/auth/login-options` (público, selector de identidad), `POST /api/v1/auth/login` (`{ userId, pin }`), `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`; administración (`ADMIN`) en `/api/v1/admin/users` (listado, activar con PIN, `reset-pin`, cambiar estado) — ningún endpoint permite que un empleado cambie su propio PIN.
- **Primer administrador**: `npm run auth:bootstrap-admin` (interactivo, PIN oculto con confirmación) — se niega si ya existe un `ADMIN` activo. Ya fue ejecutado manualmente por el usuario en `demo`; no se vuelve a correr.
- **Corrección de la Etapa 3D**: `PATCH /admin/users/:id/status` rechaza explícitamente reactivar (`-> ACTIVE`) a un usuario que nunca tuvo PIN asignado (llegó a `DEACTIVATED` directo desde `PENDING_ACTIVATION`, sin pasar por `/activate`) — antes de esta corrección, ese intento rompía el `CHECK` de la base con un 500 crudo en vez de un rechazo controlado. Ver `docs/ARCHITECTURE.md` §14.6b.

**Frontend** (Etapa 3C — selector de identidad, teclado de PIN, sesión, logout; Etapa 3D — administración de usuarios; sin dashboard todavía):
- **Access token solo en memoria** (`frontend/src/auth/accessTokenStore.ts`) — nunca `localStorage`/`sessionStorage`/`IndexedDB`. Se pierde al recargar a propósito; la restauración de sesión (`POST /auth/refresh`, single-flight) lo repone.
- **Un único refresh en vuelo, siempre**: mismo mecanismo evita que React StrictMode dispare dos `refresh` reales al montar, y que varios 401 simultáneos disparen uno cada uno — con reintento único por request y sin loops.
- **Rutas protegidas**: anónimo → login; autenticado → área protegida; restaurando sesión → pantalla de carga estable (nunca parpadea el login). `/admin/users` además exige rol `ADMIN` (`RequireRole`) — un `EMPLOYEE` autenticado ve una pantalla de acceso denegado, nunca el contenido administrativo.
- **Administración de usuarios** (`/admin/users`, Etapa 3D): listado real (`GET /admin/users`), activar con primer PIN, cambiar PIN (con advertencia de que cierra todas las sesiones activas de esa persona), cambiar estado (solo transiciones permitidas por el backend, nunca ofrece auto-bloquear al único `ADMIN` activo). Cambiar el propio PIN, o cambiar el propio estado a uno que revoca sesiones, cierra la sesión local (mismo `logout()` de siempre) en vez de refrescar la lista — nunca intenta seguir usando ni refrescar una sesión ya revocada en el servidor.
- **Proxy local de Vite**: `/api -> http://localhost:PORT` — el frontend nunca usa una URL absoluta ni una variable `VITE_*` para hablar con el backend.

## Seguridad de esta etapa

- Nada de lo encontrado en `index.html` (URL de Supabase, API key, PIN, o cualquier otro dato real) se copió al código nuevo — ver `docs/SECURITY.md` para el detalle de lo auditado.
- El backend valida sus variables de entorno con Zod al arrancar y nunca registra secretos, cookies ni el header `Authorization` en los logs.
- CORS acepta únicamente el origen configurado en `FRONTEND_URL`, con credenciales habilitadas — nunca `origin: '*'` combinado con credenciales.
- Helmet, compresión, rate limiting general (`/api`) y manejo centralizado de errores (sin stack trace en producción, ni siquiera en desarrollo para errores esperados como CORS/404) ya están activos, aunque todavía no hay endpoints de negocio que proteger.
- El seed (`backend/prisma/seed.ts`) nunca crea un administrador, nunca inventa PIN/contraseña/hash, y nunca usa `deleteMany` ni resetea datos — verificado con tests dedicados (`backend/src/test/seed-source-guards.test.ts`), no solo por inspección manual.
- `DATABASE_URL`/`DIRECT_URL` (Neon, rama `demo`) viven solo en el `.env` local, gitignored — nunca se commitean, nunca se imprimen en consola ni en documentación. `production` usa credenciales propias, configuradas directamente en Render, nunca en este repositorio ni en Netlify (ver `docs/ARCHITECTURE.md`, sección 13).
- `DATABASE_TARGET` es una barrera de código, no solo documentación: los scripts locales con capacidad de escritura fallan antes de tocar la base si no vale exactamente `"demo"` (ver `docs/ARCHITECTURE.md`, sección 13.7).
- PIN: Argon2id (nunca en texto plano, nunca en logs ni auditoría, nunca devuelto en ninguna respuesta), individual por persona, nunca compartido ni predeterminado. Login nunca revela si una identidad existe, está deshabilitada, bloqueada por intentos fallidos, o si el PIN fue el incorrecto — siempre el mismo error genérico. 5 intentos fallidos consecutivos bloquean la cuenta 15 minutos (persistente en Postgres).
- Ningún token (access ni refresh) se guarda en `localStorage`/`sessionStorage`; el refresh token solo viaja por cookie `HttpOnly`.
- `/auth/refresh` y `/auth/logout` validan el header `Origin` contra `FRONTEND_URL` antes de actuar.
