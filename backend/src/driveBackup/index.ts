import type { Prisma } from '../generated/prisma/client';
import { config as appConfig } from '../config';
import { getObjectStorage } from '../lib/objectStorage';
import { getDriveBackupConfig } from './config';
import { createDriveClient } from './driveClient';
import { DriveBackupError } from './errors';
import { createServiceAccountTokenProvider } from './googleAuth';
import { createPrismaDriveBackupStore } from './store';
import { createDriveBackupScheduler, createDriveBackupWorker, type SourceReader } from './worker';

/**
 * Punto de entrada de la copia en Drive (Etapa 5Z). Los servicios de fotos
 * solo llaman a `enqueueDriveBackup` DENTRO de su transacción de confirmación
 * (nunca a Google) y a `notifyDriveBackup` después del commit.
 */

/** Módulos con fotografías que se copian. El plano del 🌳 Jardín no: es un documento. */
export type DriveBackupModule = 'fotos' | 'mascotas';

/**
 * Registra el trabajo de copia en la transacción que deja la foto
 * `AVAILABLE` y vinculada. Con la copia desactivada no hace nada: las fotos
 * confirmadas mientras estaba apagada no se copian después (sin carga histórica).
 */
export async function enqueueDriveBackup(
  tx: Prisma.TransactionClient,
  fileAssetId: string,
  module: DriveBackupModule,
): Promise<boolean> {
  const config = getDriveBackupConfig();
  if (!config) return false;
  await tx.driveBackupJob.create({
    data: { fileAssetId, module, environment: config.environment },
  });
  return true;
}

let scheduler: ReturnType<typeof createDriveBackupScheduler> | null = null;

/** Despierta al trabajador de este proceso tras el commit de un alta. Nunca lanza. */
export function notifyDriveBackup(): void {
  scheduler?.notify();
}

/** Lee el objeto de Neon por streaming (o lo envuelve si el cliente no lo soporta). */
const readFromNeon: SourceReader = async (objectKey) => {
  const storage = getObjectStorage();
  if (!storage) {
    throw new DriveBackupError(
      'config',
      'Neon Object Storage no está configurado en este proceso.',
    );
  }
  if (storage.getObjectStream) return storage.getObjectStream(objectKey);
  const object = await storage.getObject(objectKey);
  if (!object) return null;
  return {
    body: new Blob([new Uint8Array(object.body)]).stream(),
    contentLength: object.body.length,
  };
};

/**
 * Arranca el trabajador si la copia está activada. Retoma de inmediato los
 * pendientes y los reclamos vencidos (p. ej. tras dormir en Render).
 */
export function startDriveBackup(): (() => Promise<void>) | null {
  const config = getDriveBackupConfig();
  if (!config || scheduler) return null;
  const store = createPrismaDriveBackupStore();
  const worker = createDriveBackupWorker({
    config,
    store,
    drive: createDriveClient(createServiceAccountTokenProvider(config.credentialsFile)),
    readSource: readFromNeon,
    businessTimeZone: appConfig.businessTimeZone,
  });
  const created = createDriveBackupScheduler(worker, store, config.environment);
  scheduler = created;
  created.start();
  // eslint-disable-next-line no-console -- log de arranque intencional
  console.log(`Copia de fotos en Google Drive activada (entorno ${config.environment}).`);
  return async () => {
    await created.stop();
    scheduler = null;
  };
}
