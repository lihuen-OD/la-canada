# La Cañada

Sistema de gestión operativa para la propiedad "La Cañada": tareas del equipo, inventario (casa y jardín), gallinero, mascotas, eventos, novedades, clima y datos del equipo de trabajo.

## Estado actual

El proyecto está en transición desde un prototipo de un único archivo (`index.html`, HTML + CSS + JS embebido, conectado directamente a Supabase) hacia una aplicación profesional full stack.

- **`index.html`** (raíz) y **`legacy/index.original.html`** son la referencia funcional y visual del prototipo original. Son idénticos byte a byte (mismo checksum) y **no se modifican ni se usan en tiempo de ejecución** de la nueva app: no se importan desde el código nuevo, no forman parte de ningún build y el backend no los expone como archivos estáticos.
- **Todavía no hay lógica de negocio implementada** en `frontend/` ni en `backend/` — esta etapa (Etapa 1 del plan de migración) solo crea la estructura profesional base, sin pantallas de negocio ni endpoints de negocio.
- **Todavía no hay conexión con Neon** (ni con ninguna base de datos real). `backend/prisma/schema.prisma` solo declara el `generator`/`datasource`, sin modelos.
- **Todavía no hay autenticación implementada.** El PIN del prototipo (y cualquier credencial encontrada en `index.html`) **no se copió** al código nuevo.
- **Los datos reales** (personas, tareas, stock, catálogos, etc., documentados en `docs/DATA_INVENTORY.md`) se migran recién en la Etapa 4 del plan, vía un seed de Prisma — no antes.

Ver `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md` y `docs/MIGRATION_PLAN.md` para el contexto completo y las próximas etapas.

## Arquitectura prevista

| Capa | Tecnología | Despliegue |
|---|---|---|
| Frontend | React + TypeScript + Vite | Netlify |
| Backend | Node.js + TypeScript + Express | Render |
| ORM | Prisma | — |
| Base de datos | PostgreSQL | Neon |
| Fotografías | Google Drive, vía el backend (nunca directo desde el frontend) | — |

El frontend nunca tiene credenciales de base de datos: toda operación pasa por el backend.

## Estructura del monorepo

```text
/
├── frontend/           React + TypeScript + Vite
├── backend/             Node.js + TypeScript + Express
├── legacy/
│   └── index.original.html   Copia exacta e intocable del index.html original
├── docs/                 Documentación técnica y funcional (auditoría del prototipo)
├── index.html            Prototipo original — referencia, no se modifica
├── AGENTS.md              Reglas obligatorias de trabajo en este repo
├── package.json           Orquestación del monorepo (npm workspaces)
└── .env.example           Variables de entorno centralizadas (frontend + backend)
```

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

Variables previstas para etapas futuras (no se usan todavía, no hace falta completarlas para correr el health check local): `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.

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

`index.html`, `legacy/`, `docs/` y los archivos Markdown están excluidos de Prettier a propósito (`.prettierignore`) para no reformatear el prototipo ni la documentación.

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

## Seguridad de esta etapa

- Nada de lo encontrado en `index.html` (URL de Supabase, API key, PIN, o cualquier otro dato real) se copió al código nuevo — ver `docs/SECURITY.md` para el detalle de lo auditado.
- El backend valida sus variables de entorno con Zod al arrancar y nunca registra secretos, cookies ni el header `Authorization` en los logs.
- CORS acepta únicamente el origen configurado en `FRONTEND_URL`, con credenciales habilitadas — nunca `origin: '*'` combinado con credenciales.
- Helmet, compresión, rate limiting general (`/api`) y manejo centralizado de errores (sin stack trace en producción) ya están activos, aunque todavía no hay endpoints de negocio que proteger.
