# La Cañada

Sistema de gestión operativa para la propiedad "La Cañada": tareas del equipo, inventario (casa y jardín), gallinero, mascotas, eventos, novedades, clima y datos del equipo de trabajo.

## Estado actual

El proyecto está en transición desde un prototipo de un único archivo (`index.html`, HTML + CSS + JS embebido, conectado directamente a Supabase) hacia una aplicación profesional full stack.

- **`index.html`/`legacy/index.original.html` (el prototipo original) fueron retirados del repositorio.** Contenían una URL y una API key reales de Supabase hardcodeadas en texto plano (ver `docs/SECURITY.md`); una vez confirmado que todo su contenido funcional, visual y de datos ya estaba migrado a `docs/`, al modelo Prisma y al seed, se eliminaron del árbol de trabajo **y de todo el historial de Git** (Etapa 2.3 — ver `docs/MIGRATION_PLAN.md`). La referencia de diseño y comportamiento del prototipo vive ahora exclusivamente en `docs/` (`PROJECT_CONTEXT.md`, `BUSINESS_RULES.md`, `DATABASE.md`, `DATA_INVENTORY.md`).
- **Todavía no hay pantallas ni endpoints de negocio implementados** en `frontend/` ni en `backend/` — las Etapas 1 y 2 del plan de migración crearon la estructura profesional base y el modelo de datos + seed, sin lógica de negocio corriendo todavía.
- **El modelo de datos ya está diseñado** (`backend/prisma/schema.prisma`, 22 modelos) y hay un seed idempotente escrito (`backend/prisma/seed.ts`) con los datos reales del prototipo — pero **todavía no hay conexión con Neon**: no se ejecutó ninguna migración, ningún `db push` ni el seed.
- **Todavía no hay autenticación implementada.** El PIN del prototipo (y cualquier credencial encontrada en el HTML original) **no se copió** al código nuevo, y el archivo que las contenía ya fue retirado del repositorio (ver punto anterior). El modelo ya tiene `User`/`Session` listos para cuando se implemente (Etapa 3).
- **Los datos reales** (personas, tareas, stock, catálogos, etc.) están descritos exactamente en `docs/SEED_MANIFEST.md` y listos para cargarse — la carga real contra una base ocurre recién en una etapa futura de despliegue, no antes.

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
- El **frontend** (Vite) también lo lee desde la raíz gracias a `envDir` en `frontend/vite.config.ts` — solo las variables prefijadas con `VITE_` llegan al navegador; el resto queda exclusivamente en el backend.

Variables usadas en esta etapa:

| Variable | Usada por | Obligatoria ahora |
|---|---|---|
| `NODE_ENV` | Backend | No (default `development`) |
| `PORT` | Backend | No (default `4000`) |
| `FRONTEND_URL` | Backend (CORS) | **Sí** — sin ella el backend no arranca |
| `VITE_API_URL` | Frontend | Sí, para que el cliente HTTP sepa a qué backend llamar |

Variables previstas para etapas futuras (no se usan todavía, no hace falta completarlas para correr el health check local): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` (Neon Object Storage, reemplaza a Google Drive — ver `docs/ARCHITECTURE.md`).

Ninguna de estas variables tiene valores reales en `.env.example` ni en el código.

## Ejecución

```bash
# Frontend y backend juntos (concurrently)
npm run dev

# Por separado
npm run dev:frontend   # Vite dev server, http://localhost:5173
npm run dev:backend    # Express con recarga automática, http://localhost:4000
```

## Build

```bash
npm run build
```

Compila (typecheck + bundle) el frontend a `frontend/dist/` y compila el backend a `backend/dist/`.

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

No incluye estado de Neon todavía porque el backend no se conecta a ninguna base en esta etapa.

## Base de datos (Prisma)

El modelo de datos está diseñado y listo (`backend/prisma/schema.prisma`, 22 modelos — ver `docs/DATABASE.md` para el detalle completo), pero **no está conectado a ninguna base todavía**. Comandos disponibles sin necesitar `DATABASE_URL` (no requieren conexión):

```bash
cd backend
npx prisma format      # formatea prisma/schema.prisma
npx prisma validate    # valida el schema estáticamente
npx prisma generate    # genera el cliente TS en src/generated/prisma/ (también corre solo, vía postinstall)
```

`prisma generate` corre automáticamente después de `npm install` (script `postinstall` de `backend/package.json`) — la carpeta generada está en `.gitignore`, no se commitea.

**Seed** (`backend/prisma/seed.ts` + `backend/prisma/seed-data/`): contiene los datos reales del prototipo (4 empleados, 4 usuarios pendientes de activación, 10 tareas, 14 productos de stock, categorías, novedades, eventos, cumpleaños recurrentes, tipos de mascota — **61 entidades maestras + 14 movimientos de apertura de stock = 75 filas potenciales en total**, manifiesto exacto en `docs/SEED_MANIFEST.md`). Es idempotente (se puede correr más de una vez sin duplicar nada, con claves naturales estables por entidad — nunca UUID adivinado) y **todavía no se ejecutó contra ninguna base** — eso requiere `DATABASE_URL` configurada y corresponde a una etapa futura de conexión real a Neon.

Prisma 7 movió la configuración de conexión fuera de `schema.prisma` a `backend/prisma.config.ts` — ver `docs/ARCHITECTURE.md` §10 para el detalle de este y otros cambios de la versión instalada.

## Seguridad de esta etapa

- Nada de lo encontrado en `index.html` (URL de Supabase, API key, PIN, o cualquier otro dato real) se copió al código nuevo — ver `docs/SECURITY.md` para el detalle de lo auditado.
- El backend valida sus variables de entorno con Zod al arrancar y nunca registra secretos, cookies ni el header `Authorization` en los logs.
- CORS acepta únicamente el origen configurado en `FRONTEND_URL`, con credenciales habilitadas — nunca `origin: '*'` combinado con credenciales.
- Helmet, compresión, rate limiting general (`/api`) y manejo centralizado de errores (sin stack trace en producción, ni siquiera en desarrollo para errores esperados como CORS/404) ya están activos, aunque todavía no hay endpoints de negocio que proteger.
- El seed (`backend/prisma/seed.ts`) nunca crea un administrador, nunca inventa PIN/contraseña/hash, y nunca usa `deleteMany` ni resetea datos — verificado con tests dedicados (`backend/src/test/seed-source-guards.test.ts`), no solo por inspección manual.
