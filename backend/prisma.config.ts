import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// A diferencia de versiones anteriores de Prisma, la CLI ya no carga
// automáticamente un `.env` del monorepo (solo buscaría uno junto a este
// archivo). Este `.env` vive en la raíz del monorepo (un nivel arriba de
// `backend/`, igual que en `backend/src/config/index.ts`) — se carga acá
// explícitamente, antes de que `env('DIRECT_URL')` intente resolverla más
// abajo. Verificado de forma empírica: sin esta línea, `prisma format`
// falla con `PrismaConfigEnvError: Cannot resolve environment variable`
// incluso con `DIRECT_URL` definida en el `.env` de la raíz.
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
// Etapa 3A — ya hay conexión a Neon (rama `demo` exclusivamente): se usa acá
// `DIRECT_URL` (conexión directa, sin pooler) a propósito, nunca
// `DATABASE_URL` (pooled) — Prisma Migrate no debe correr DDL a través del
// pooler de Neon. El *runtime* de la app y el seed (`prisma/seed.ts`) siguen
// usando `DATABASE_URL` por separado, vía `@prisma/adapter-pg`
// (`backend/src/lib/prisma.ts`) — nunca este archivo.
//
// `env('DIRECT_URL')` se resuelve de forma *eager* al cargar este archivo:
// si la variable falta, falla con un mensaje claro (sin imprimir su
// contenido) apenas se ejecuta un comando de Schema Engine — comandos que no
// tocan la base (`validate`, `generate`, `format`) no pasan por acá.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
