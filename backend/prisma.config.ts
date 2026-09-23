import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// A diferencia de versiones anteriores de Prisma, la CLI ya no carga
// automáticamente un `.env` del monorepo (solo buscaría uno junto a este
// archivo). Este `.env` vive en la raíz del monorepo (un nivel arriba de
// `backend/`, igual que en `backend/src/config/index.ts`) — se carga acá
// explícitamente. Si el archivo no existe (build offline, CI recién
// clonado), `dotenv` no lanza error y simplemente no setea nada — mismo
// comportamiento documentado para el resto del proyecto.
loadDotenvFile({ path: resolve(process.cwd(), '../.env') });

// Prisma 7 movió la configuración de conexión fuera de schema.prisma (ya no
// admite `datasource { url = ... }`). Este archivo es leído por el Schema
// Engine para comandos que necesitan una base (`migrate`, `db push`,
// `db seed`) — la forma real de `PrismaConfig` (verificada contra
// `node_modules/@prisma/config/dist/index.d.ts` de la versión instalada,
// 7.10.0) solo admite `datasource.url` (y opcionalmente
// `datasource.shadowDatabaseUrl`), no un campo separado "directUrl": es UN
// único valor para todo el Schema Engine.
//
// `datasource` se arma de forma CONDICIONAL a propósito (corrección
// posterior a la Etapa 3A): usar el helper `env('DIRECT_URL')` de
// `prisma/config` resuelve la variable de forma *eager* al cargar este
// archivo y rompía `prisma format`/`validate`/`generate` — comandos
// puramente estáticos que no tocan ninguna base — cuando `DIRECT_URL` no
// estaba definida (p. ej. build offline, CI recién clonado, sin `.env`).
// Acá se lee `process.env.DIRECT_URL` directamente (nunca falla por sí
// solo) y `datasource` se omite por completo si falta — nunca se inventa
// una URL de reemplazo ni se guarda una connection string ficticia.
// `migrate`/`db seed` sí necesitan una base real: si `DIRECT_URL` falta,
// los scripts oficiales del proyecto (`npm run db:migrate:*`, `db:seed`)
// fallan antes de llegar acá, con un mensaje claro, vía
// `backend/src/scripts/guardDbCommand.ts` — invocar `npx prisma migrate ...`
// directamente sin pasar por esos scripts sigue quedando sujeto al error
// (menos amigable, pero no inseguro) que Prisma da por su cuenta sin
// datasource configurado.
//
// Etapa 3A — ya hay conexión a Neon (rama `demo` exclusivamente): cuando
// `DIRECT_URL` está presente, se usa esa conexión directa (sin pooler) a
// propósito, nunca `DATABASE_URL` (pooled) — Prisma Migrate no debe correr
// DDL a través del pooler de Neon. El *runtime* de la app y el seed
// (`prisma/seed.ts`) siguen usando `DATABASE_URL` por separado, vía
// `@prisma/adapter-pg` (`backend/src/lib/prisma.ts`) — nunca este archivo.
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
