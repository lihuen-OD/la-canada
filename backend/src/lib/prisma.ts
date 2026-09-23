import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { config } from '../config';

/**
 * Fábrica pura (no depende de `process.env` directamente, solo de un
 * argumento) para poder testearla con valores sintéticos — mismo patrón que
 * `loadEnv` en `config/env.ts`. Usa siempre la conexión *pooled*
 * (`DATABASE_URL`) — nunca `DIRECT_URL`, exclusiva de Prisma Migrate (ver
 * `backend/prisma.config.ts`).
 */
export function createPrismaClient(databaseUrl: string | undefined): PrismaClient {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL no está definida. El cliente Prisma no puede inicializarse sin ella ' +
        '(ver .env.example) — no se revela su contenido en este error.',
    );
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/**
 * Cliente Prisma único y reutilizable para todo el backend. Nunca debe
 * instanciarse un `PrismaClient` por request — los servicios futuros
 * (Etapa 5) deben importar `prisma` desde acá, no crear el suyo.
 */
export const prisma = createPrismaClient(config.databaseUrl);

/** Cierre ordenado de la conexión — se invoca desde el apagado del servidor (ver `server.ts`). */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
