import type { DriveBackupEnvironment, PhotoCategory } from '../generated/prisma/enums';
import { toLocalDate } from '../lib/businessTime';
import { ENVIRONMENT_FOLDER, type DriveBackupConfig } from './config';
import type { DriveClient } from './driveClient';
import { DriveBackupError, sanitizeError, type DriveErrorKind } from './errors';
import type { ClaimedJob, DriveBackupStore, SourceFile } from './store';

/**
 * Trabajador de la copia en Drive (Etapa 5Z, docs/ARCHITECTURE.md §37).
 *
 * - Durable: los trabajos viven en `drive_backup_jobs`; al arrancar se
 *   retoman los pendientes y los reclamos vencidos de un proceso caído.
 * - Exclusión: el reclamo es atómico (`SKIP LOCKED`) y vence; solo el dueño
 *   del token puede cerrar el trabajo.
 * - Sin duplicados: el ID de Drive se pre-genera y se guarda ANTES de subir.
 *   Un reintento primero consulta ese ID; si no está, sube con el MISMO ID
 *   (Drive responde 409 si ya existía). Nunca se identifica por nombre.
 * - Sin sondeo frecuente: duerme hasta el próximo vencimiento conocido o lo
 *   despierta un aviso de un alta en este proceso; si no hay trabajos, solo
 *   revisa cada `idleRecheckMs`. Render puede dormir: lo pendiente se
 *   retoma al volver a arrancar (no hay keep-alive).
 * - Nunca borra ni modifica archivos de Drive.
 */

export const DRIVE_BACKUP_LIMITS = {
  batchSize: 5,
  concurrency: 2,
  /** Mayor que el peor caso de un trabajo (metadatos + subida de 120 s). */
  leaseMs: 10 * 60_000,
  maxAttempts: 12,
  baseBackoffMs: 60_000,
  maxBackoffMs: 60 * 60_000,
  configBackoffMs: 30 * 60_000,
  idleRecheckMs: 30 * 60_000,
  storeErrorRetryMs: 60_000,
  /** Las fotos de la app pesan como máximo 10 MB (galería) y 5 MB (mascotas). */
  maxSourceBytes: 10 * 1024 * 1024,
} as const;

export const FILE_ID_PROPERTY = 'laCanadaFileAssetId';
export const FOLDER_PATH_PROPERTY = 'laCanadaFolder';

const CATEGORY_LABEL: Partial<Record<PhotoCategory, string>> = {
  MEMORY: 'recuerdo',
  TASK_EVIDENCE: 'evidencia',
  ANIMAL_PROFILE: 'mascota',
};
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface OpenedSource {
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
}

/** Lector del objeto en Neon (`null` si ya no existe). */
export type SourceReader = (objectKey: string) => Promise<OpenedSource | null>;

export interface WorkerDeps {
  config: DriveBackupConfig;
  store: DriveBackupStore;
  drive: DriveClient;
  readSource: SourceReader;
  businessTimeZone: string;
  now?: () => Date;
  random?: () => number;
  log?: (message: string) => void;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Ruta lógica de carpetas: entorno / módulo / año / mes (fecha de carga, zona del negocio). */
export function folderSegments(
  environment: DriveBackupEnvironment,
  module: string,
  createdAt: Date,
  timeZone: string,
): string[] {
  const date = toLocalDate(createdAt, timeZone);
  return [ENVIRONMENT_FOLDER[environment], module, String(date.year), pad(date.month)];
}

/** Nombre legible sin datos personales: fecha, tipo e ID estable del archivo. */
export function backupFileName(fileAssetId: string, source: SourceFile, timeZone: string): string {
  const date = toLocalDate(source.createdAt, timeZone);
  const label = CATEGORY_LABEL[source.category] ?? 'foto';
  const extension = EXTENSION[source.mimeType] ?? 'bin';
  return `${date.year}-${pad(date.month)}-${pad(date.day)}_${label}_${fileAssetId}.${extension}`;
}

/** Espera antes del próximo intento según el tipo de error (con ±20 % de jitter). */
export function backoffDelayMs(kind: DriveErrorKind, attempts: number, random = Math.random) {
  const base =
    kind === 'config'
      ? DRIVE_BACKUP_LIMITS.configBackoffMs
      : Math.min(
          DRIVE_BACKUP_LIMITS.baseBackoffMs * 2 ** Math.max(0, attempts - 1),
          DRIVE_BACKUP_LIMITS.maxBackoffMs,
        );
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Corta el stream si trae más bytes que los declarados (límite de memoria y de red). */
function limitBytes(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) {
          controller.error(
            new DriveBackupError('invalid', 'El objeto de Neon excede el tamaño declarado.'),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

class ClaimLostError extends Error {}

export function createDriveBackupWorker(deps: WorkerDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((message: string) => console.error(message));
  const { config, store, drive } = deps;
  const folderCache = new Map<string, string>();
  let sharedDriveId: string | null | undefined;

  async function resolveDriveId(): Promise<string | null> {
    if (sharedDriveId === undefined) {
      const destination = await drive.describeDestination(config.destinationId);
      sharedDriveId = destination.driveId;
    }
    return sharedDriveId;
  }

  /**
   * Carpeta de una ruta, creada una sola vez aunque dos trabajadores la pidan a
   * la vez: el ID se elige en la base (`path` es la clave primaria; gana el
   * primero) y se crea en Drive con ese ID pre-generado, así que un segundo
   * intento de creación responde 409 en vez de duplicar la carpeta.
   */
  async function ensureFolder(segments: string[]): Promise<string> {
    let parentId = config.destinationId;
    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      const cached = folderCache.get(path);
      if (cached) {
        parentId = cached;
        continue;
      }
      let folderId = await store.getFolder(path);
      if (!folderId) {
        // Por si la base perdió la fila (p. ej. restaurada): se reutiliza la carpeta marcada.
        const [existing] = await drive.findByAppProperty(FOLDER_PATH_PROPERTY, path, {
          driveId: await resolveDriveId(),
          parentId,
          folder: true,
        });
        folderId = await store.insertFolderIfAbsent(
          path,
          existing?.id ?? (await drive.generateId()),
        );
      }
      const remote = await drive.getFile(folderId);
      if (remote && remote.mimeType !== 'application/vnd.google-apps.folder') {
        throw new DriveBackupError('invalid', `El ID de la carpeta ${path} no es una carpeta.`);
      }
      if (!remote || remote.trashed) {
        if (remote?.trashed) {
          throw new DriveBackupError('config', `La carpeta ${path} está en la papelera de Drive.`);
        }
        try {
          await drive.createFolder({
            id: folderId,
            name: segments[index] ?? path,
            parentId,
            appProperties: { [FOLDER_PATH_PROPERTY]: path },
          });
        } catch (error) {
          if (!(error instanceof DriveBackupError && error.kind === 'conflict')) throw error;
        }
      }
      folderCache.set(path, folderId);
      parentId = folderId;
    }
    return parentId;
  }

  const isOurCopy = (
    file: { trashed: boolean; appProperties: Record<string, string> },
    id: string,
  ) => !file.trashed && file.appProperties[FILE_ID_PROPERTY] === id;

  /** ¿La copia ya está en Drive? (respuesta perdida, proceso caído, reintento). */
  async function findExistingCopy(job: ClaimedJob): Promise<string | null> {
    if (job.remoteFileId) {
      const remote = await drive.getFile(job.remoteFileId);
      if (remote && isOurCopy(remote, job.fileAssetId)) return remote.id;
      if (remote) {
        throw new DriveBackupError('invalid', 'El ID reservado en Drive pertenece a otro archivo.');
      }
      return null;
    }
    if (job.attempts > 1) {
      // Sin ID guardado nunca se subió nada; igual se verifica por la marca de la app.
      const [found] = await drive.findByAppProperty(FILE_ID_PROPERTY, job.fileAssetId, {
        driveId: await resolveDriveId(),
      });
      if (found) return found.id;
    }
    return null;
  }

  type Outcome =
    | { status: 'COMPLETED'; remoteFileId: string; folderId: string | null }
    | { status: 'SOURCE_MISSING'; message: string };

  async function copy(job: ClaimedJob): Promise<Outcome> {
    const existing = await findExistingCopy(job);
    if (existing) return { status: 'COMPLETED', remoteFileId: existing, folderId: null };

    // Eliminada en la app antes de copiarse: no hay nada que conservar.
    const source = await store.readSource(job.fileAssetId);
    if (!source || source.status !== 'AVAILABLE') {
      return { status: 'SOURCE_MISSING', message: 'La foto se eliminó antes de copiarse.' };
    }
    if (source.sizeBytes <= 0 || source.sizeBytes > DRIVE_BACKUP_LIMITS.maxSourceBytes) {
      throw new DriveBackupError('invalid', 'Tamaño de la foto fuera de los límites de la copia.');
    }

    const folderId = await ensureFolder(
      folderSegments(job.environment, job.module, source.createdAt, deps.businessTimeZone),
    );

    let remoteFileId = job.remoteFileId;
    if (!remoteFileId) {
      remoteFileId = await drive.generateId();
      if (!(await store.saveRemoteFileId(job, remoteFileId))) throw new ClaimLostError();
    }

    const opened = await deps.readSource(source.objectKey);
    if (!opened) {
      return { status: 'SOURCE_MISSING', message: 'El objeto ya no existe en Neon.' };
    }
    if (opened.contentLength !== null && opened.contentLength !== source.sizeBytes) {
      await opened.body.cancel().catch(() => undefined);
      throw new DriveBackupError('transient', 'El tamaño del objeto en Neon no coincide.');
    }

    try {
      await drive.uploadFile({
        id: remoteFileId,
        name: backupFileName(job.fileAssetId, source, deps.businessTimeZone),
        parentId: folderId,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        appProperties: {
          [FILE_ID_PROPERTY]: job.fileAssetId,
          laCanadaEnv: ENVIRONMENT_FOLDER[job.environment],
        },
        body: limitBytes(opened.body, source.sizeBytes),
      });
    } catch (error) {
      if (!(error instanceof DriveBackupError && error.kind === 'conflict')) throw error;
      // 409: el ID ya existe. Se confirma que es ESTA copia antes de cerrar.
      const remote = await drive.getFile(remoteFileId);
      if (!remote || !isOurCopy(remote, job.fileAssetId)) {
        throw new DriveBackupError(
          'transient',
          'Drive informó un conflicto sin la copia esperada.',
        );
      }
    }
    return { status: 'COMPLETED', remoteFileId, folderId };
  }

  /** Procesa un trabajo reclamado. Nunca lanza: todo resultado queda en la base. */
  async function processJob(job: ClaimedJob): Promise<void> {
    try {
      const outcome = await copy(job);
      if (outcome.status === 'COMPLETED') {
        await store.complete(job, outcome.remoteFileId, outcome.folderId, now());
      } else {
        await store.finish(job, 'SOURCE_MISSING', {
          kind: 'source_missing',
          message: outcome.message,
        });
      }
    } catch (error) {
      if (error instanceof ClaimLostError) return; // otro trabajador lo tiene
      const sanitized = sanitizeError(error);
      if (sanitized.kind === 'invalid' || job.attempts >= DRIVE_BACKUP_LIMITS.maxAttempts) {
        await store.finish(job, 'FAILED', sanitized).catch(() => undefined);
        log(`Copia en Drive fallida definitivamente (${sanitized.kind}): ${sanitized.message}`);
        return;
      }
      const delay = backoffDelayMs(sanitized.kind, job.attempts, deps.random);
      await store
        .reschedule(job, new Date(now().getTime() + delay), sanitized)
        .catch(() => undefined);
      log(`Copia en Drive reprogramada (${sanitized.kind}): ${sanitized.message}`);
    }
  }

  /** Un lote: reclama y procesa con concurrencia acotada. Devuelve cuántos reclamó. */
  async function runBatch(): Promise<number> {
    const jobs = await store.claimDue(
      config.environment,
      now(),
      DRIVE_BACKUP_LIMITS.batchSize,
      DRIVE_BACKUP_LIMITS.leaseMs,
    );
    const queue = [...jobs];
    const lanes = Array.from(
      { length: Math.min(DRIVE_BACKUP_LIMITS.concurrency, queue.length) },
      async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await processJob(job);
      },
    );
    await Promise.all(lanes);
    return jobs.length;
  }

  return { processJob, runBatch, ensureFolder };
}

export type DriveBackupWorker = ReturnType<typeof createDriveBackupWorker>;

/**
 * Planificador en proceso. Una sola ejecución a la vez; duerme con un timer
 * `unref` (no mantiene vivo el proceso) hasta el próximo vencimiento.
 */
export function createDriveBackupScheduler(
  worker: Pick<DriveBackupWorker, 'runBatch'>,
  store: Pick<DriveBackupStore, 'nextWakeAt'>,
  environment: DriveBackupEnvironment,
  options: { now?: () => Date; log?: (message: string) => void } = {},
) {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.error(message));
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;
  let stopped = false;

  function schedule(delayMs: number) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => {
        timer = null;
        void tick();
      },
      Math.max(0, delayMs),
    );
    timer.unref();
  }

  async function cycle(): Promise<number> {
    try {
      // Mientras los lotes salen llenos, hay más trabajo vencido: se sigue.
      while (!stopped && (await worker.runBatch()) === DRIVE_BACKUP_LIMITS.batchSize);
      const next = await store.nextWakeAt(environment);
      if (!next) return DRIVE_BACKUP_LIMITS.idleRecheckMs;
      return Math.min(
        Math.max(next.getTime() - now().getTime(), 1_000),
        DRIVE_BACKUP_LIMITS.idleRecheckMs,
      );
    } catch {
      log('Copia en Drive: no se pudo leer la cola; se reintenta en un minuto.');
      return DRIVE_BACKUP_LIMITS.storeErrorRetryMs;
    }
  }

  async function tick(): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      let delay = await cycle();
      while (rerun && !stopped) {
        rerun = false;
        delay = await cycle();
      }
      schedule(delay);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    /** Arranque: retoma pendientes y reclamos vencidos de inmediato. */
    start() {
      stopped = false;
      schedule(0);
    },
    /** Un alta nueva en este proceso: procesar pronto sin consultar de más. */
    notify() {
      if (!stopped) schedule(0);
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await running;
    },
    /** Solo tests: ejecuta un ciclo y devuelve la espera elegida. */
    runOnce: cycle,
  };
}
