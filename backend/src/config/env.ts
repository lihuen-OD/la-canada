import { z } from 'zod';

/**
 * Variables previstas para etapas futuras (Neon, JWT, Object Storage) se
 * dejan opcionales a propósito: no deben bloquear el arranque del backend
 * en esta etapa, en la que todavía no se usan. Cuando se implemente el
 * módulo de archivos, esta validación deberá poder volver obligatorias las
 * variables de `OBJECT_STORAGE_*` (hoy opcionales).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z
    .string({ message: 'FRONTEND_URL es obligatoria (la usa CORS para aceptar un único origen).' })
    .url({ message: 'FRONTEND_URL debe ser una URL válida, ej: http://localhost:5173' }),

  // DATABASE_URL (pooled) — runtime de la app y del seed. DIRECT_URL
  // (directa) — exclusiva de Prisma Migrate (ver backend/prisma.config.ts).
  // Ambas opcionales acá: el servidor Express no falla al arrancar sin
  // ellas todavía (ningún endpoint usa Prisma en esta etapa); el cliente
  // Prisma (`backend/src/lib/prisma.ts`) valida DATABASE_URL por su cuenta,
  // con un error claro y sin revelar su contenido, recién cuando se
  // instancia.
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().optional(),
  REFRESH_TOKEN_TTL: z.string().optional(),

  // Neon Object Storage (interfaz S3) — reemplaza a Google Drive, ver
  // docs/ARCHITECTURE.md, "Object Storage". Backend local usa únicamente la
  // rama/bucket `demo`; Render (producción) usa únicamente `production`.
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Función pura (no lee `process.env` por sí misma) para poder testearla con
 * distintos entornos simulados sin depender de variables globales.
 */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }
  return parsed.data;
}
