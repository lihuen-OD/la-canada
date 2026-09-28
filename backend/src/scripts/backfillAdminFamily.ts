import { prisma } from '../lib/prisma';
import { backfillAdminFamily } from '../more/familyBackfill';

/**
 * `npm run family:backfill-admin` (Etapa 5F): asocia Vicky y Felicitas al
 * único ADMIN activo — ver `more/familyBackfill.ts`. Protegido dos veces: el
 * script npm pasa primero por `guardDbCommand` (`DATABASE_TARGET=demo`,
 * conexión pooled) y este archivo vuelve a exigirlo antes de conectarse. Para
 * `production` se habilitará explícitamente al preparar ese entorno. Solo
 * imprime slugs y conteos: nunca ids, usernames ni URLs.
 */
async function main(): Promise<void> {
  if (process.env.DATABASE_TARGET !== 'demo') {
    throw new Error('DATABASE_TARGET debe ser exactamente "demo" para ejecutar este backfill.');
  }
  const report = await backfillAdminFamily();
  // eslint-disable-next-line no-console -- solo slugs y conteos
  console.log(JSON.stringify(report));
}

main()
  .catch((error: unknown) => {
    console.error(
      'No se pudo asociar la familia del ADMIN:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
