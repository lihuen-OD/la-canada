import { prisma } from '../lib/prisma';
import { reconcileFileAssets } from '../more/photosService';

/**
 * Detección y compensación de archivos huérfanos (docs/ARCHITECTURE.md §9.6,
 * §26). Sin `--apply` solo informa conteos (lectura). Con `--apply` reintenta
 * el borrado físico de `PENDING_DELETION` y descarta subidas que quedaron
 * `PENDING_UPLOAD`/`UPLOAD_FAILED` hace más de una hora. Nunca toca archivos
 * `AVAILABLE` ni imprime claves, buckets o credenciales.
 */
async function main(): Promise<void> {
  const result = await reconcileFileAssets({ apply: process.argv.includes('--apply') });
  // eslint-disable-next-line no-console -- solo conteos agregados
  console.log(JSON.stringify(result));
}

main()
  .catch((error: unknown) => {
    console.error(
      'No se pudo reconciliar el almacenamiento:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
