import { z } from 'zod';

/**
 * Variables previstas para etapas futuras (JWT, Object Storage) se dejan
 * opcionales a propósito: no deben bloquear el arranque del backend en esta
 * etapa, en la que todavía no se usan. `DATABASE_URL` es la única excepción
 * deliberada a esa regla — ver el comentario junto al campo.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z
    .string({ message: 'FRONTEND_URL es obligatoria (la usa CORS para aceptar un único origen).' })
    .url({ message: 'FRONTEND_URL debe ser una URL válida, ej: http://localhost:5173' }),

  // DATABASE_URL (pooled) — OBLIGATORIA: el backend real (server.ts, vía
  // lib/prisma.ts) siempre necesita un cliente Prisma, así que falla acá
  // mismo, temprano y con un mensaje claro, en vez de fallar más tarde y de
  // forma menos obvia dentro de lib/prisma.ts. Nunca se revela su valor en
  // el mensaje de error. Los tests unitarios usan un valor sintético
  // inyectado por `vitest.config.mts` (nunca se conectan de verdad — nada
  // en la suite normal ejecuta una query).
  DATABASE_URL: z.string({
    message:
      'DATABASE_URL es obligatoria para iniciar el backend (ver .env.example) — nunca se expone su valor en los mensajes de error.',
  }),
  // DIRECT_URL (directa) — exclusiva de Prisma Migrate
  // (backend/prisma.config.ts). El servidor nunca la necesita para arrancar
  // ni para servir requests: queda opcional acá a propósito.
  DIRECT_URL: z.string().optional(),
  // Gate explícito (demo | production) que exigen los scripts locales con
  // capacidad de escritura (seed, migraciones, tests de integración) antes
  // de tocar la base — ver backend/src/scripts/guardDbCommand.ts. El
  // servidor Express no lo necesita para arrancar: queda opcional acá:
  // el enforcement real vive en el guard de cada script, no en el arranque
  // general de la app.
  DATABASE_TARGET: z.enum(['demo', 'production']).optional(),
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
