import { prisma } from '../lib/prisma';

/**
 * Comprobación técnica mínima de conexión — de solo lectura, no modifica la
 * base. Pensado para correr manualmente (`npm run db:check`) antes de
 * cualquier migración o seed, nunca como parte de la suite de tests normal
 * (ver `docs/SECURITY.md`/`docs/ARCHITECTURE.md`, "Neon — rama demo").
 * No imprime la connection string ni ningún dato de fila.
 */
async function main(): Promise<void> {
  const result = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`;
  const ok = result[0]?.ok === 1;
  if (!ok) {
    throw new Error('La conexión respondió, pero el resultado de "SELECT 1" fue inesperado.');
  }
  // eslint-disable-next-line no-console -- resultado agregado, sin datos sensibles
  console.log('Conexión a la base de datos OK (SELECT 1 → 1).');
}

main()
  .catch((error: unknown) => {
    console.error(
      'No se pudo conectar a la base de datos:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
