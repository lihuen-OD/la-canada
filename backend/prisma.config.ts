import { defineConfig } from 'prisma/config';

// Prisma 7 movió la configuración de conexión fuera de schema.prisma (ya no
// admite `datasource { url = ... }`). Este archivo es leído por el Schema
// Engine para comandos que necesitan una base (migrate, db push, db seed).
//
// A propósito NO se declara `datasource.url` acá todavía: `env('DATABASE_URL')`
// se resuelve de forma *eager* al cargar este archivo, y como en esta etapa
// `DATABASE_URL` no está seteada (no hay conexión a Neon), eso rompería
// incluso comandos que no necesitan base (`validate`, `generate`, `format`).
// Cuando corresponda conectar Neon (etapa futura), agregar acá:
//   import { defineConfig, env } from 'prisma/config';
//   datasource: { url: env('DATABASE_URL') }
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
