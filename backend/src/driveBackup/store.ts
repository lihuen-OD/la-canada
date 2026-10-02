import { Prisma } from '../generated/prisma/client';
import type { DriveBackupEnvironment, FileStatus, PhotoCategory } from '../generated/prisma/enums';
import { prisma } from '../lib/prisma';

/**
 * Persistencia de la cola de copias en Drive (Etapa 5Z). Toda escritura de
 * un trabajo reclamado exige su `claim_token`: si el reclamo venció y otro
 * trabajador lo tomó, el anterior ya no puede cerrarlo ni pisarlo.
 */

export interface ClaimedJob {
  id: string;
  fileAssetId: string;
  environment: DriveBackupEnvironment;
  module: string;
  /** Ya incluye el intento actual (se incrementa al reclamar). */
  attempts: number;
  remoteFileId: string | null;
  claimToken: string;
}

export interface SourceFile {
  status: FileStatus;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  category: PhotoCategory;
  createdAt: Date;
}

export type JobError = { kind: string; message: string };

export interface DriveBackupStore {
  /** Reclama atómicamente hasta `limit` trabajos vencidos (o con reclamo vencido) del entorno. */
  claimDue(
    environment: DriveBackupEnvironment,
    now: Date,
    limit: number,
    leaseMs: number,
  ): Promise<ClaimedJob[]>;
  /** Guarda el ID pre-generado ANTES de subir. `false` si se perdió el reclamo. */
  saveRemoteFileId(job: ClaimedJob, remoteFileId: string): Promise<boolean>;
  complete(
    job: ClaimedJob,
    remoteFileId: string,
    remoteFolderId: string | null,
    now: Date,
  ): Promise<boolean>;
  reschedule(job: ClaimedJob, nextAttemptAt: Date, error: JobError): Promise<boolean>;
  finish(job: ClaimedJob, status: 'FAILED' | 'SOURCE_MISSING', error: JobError): Promise<boolean>;
  /** Próximo instante con trabajo (pendiente o reclamo por vencer); `null` si no hay. */
  nextWakeAt(environment: DriveBackupEnvironment): Promise<Date | null>;
  readSource(fileAssetId: string): Promise<SourceFile | null>;
  getFolder(path: string): Promise<string | null>;
  /** Inserta la ruta si no existe y devuelve el ID ganador (el primero que la insertó). */
  insertFolderIfAbsent(path: string, remoteFolderId: string): Promise<string>;
}

interface ClaimRow {
  id: string;
  file_asset_id: string;
  environment: DriveBackupEnvironment;
  module: string;
  attempts: number;
  remote_file_id: string | null;
  claim_token: string;
}

const owned = (job: ClaimedJob) =>
  ({ id: job.id, status: 'IN_PROGRESS', claimToken: job.claimToken }) as const;

export function createPrismaDriveBackupStore(client = prisma): DriveBackupStore {
  return {
    async claimDue(environment, now, limit, leaseMs) {
      const expiresAt = new Date(now.getTime() + leaseMs);
      // `FOR UPDATE SKIP LOCKED`: dos trabajadores (o dos procesos) nunca
      // toman la misma fila; cada fila recibe su propio token aleatorio.
      const rows = await client.$queryRaw<ClaimRow[]>(Prisma.sql`
        UPDATE "drive_backup_jobs"
           SET "status" = 'IN_PROGRESS',
               "claim_token" = gen_random_uuid(),
               "claim_expires_at" = ${expiresAt},
               "attempts" = "attempts" + 1,
               "updated_at" = ${now}
         WHERE "id" IN (
           SELECT "id" FROM "drive_backup_jobs"
            WHERE "environment" = ${environment}::"DriveBackupEnvironment"
              AND (("status" = 'PENDING' AND "next_attempt_at" <= ${now})
                OR ("status" = 'IN_PROGRESS' AND "claim_expires_at" <= ${now}))
            ORDER BY "next_attempt_at", "id"
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
         )
     RETURNING "id", "file_asset_id", "environment", "module", "attempts",
               "remote_file_id", "claim_token"`);
      return rows.map((row) => ({
        id: row.id,
        fileAssetId: row.file_asset_id,
        environment: row.environment,
        module: row.module,
        attempts: row.attempts,
        remoteFileId: row.remote_file_id,
        claimToken: row.claim_token,
      }));
    },

    async saveRemoteFileId(job, remoteFileId) {
      const { count } = await client.driveBackupJob.updateMany({
        where: { ...owned(job), remoteFileId: null },
        data: { remoteFileId },
      });
      return count === 1;
    },

    async complete(job, remoteFileId, remoteFolderId, now) {
      const { count } = await client.driveBackupJob.updateMany({
        where: owned(job),
        data: {
          status: 'COMPLETED',
          remoteFileId,
          remoteFolderId,
          completedAt: now,
          claimToken: null,
          claimExpiresAt: null,
          lastErrorKind: null,
          lastErrorMessage: null,
        },
      });
      return count === 1;
    },

    async reschedule(job, nextAttemptAt, error) {
      const { count } = await client.driveBackupJob.updateMany({
        where: owned(job),
        data: {
          status: 'PENDING',
          nextAttemptAt,
          claimToken: null,
          claimExpiresAt: null,
          lastErrorKind: error.kind,
          lastErrorMessage: error.message,
        },
      });
      return count === 1;
    },

    async finish(job, status, error) {
      const { count } = await client.driveBackupJob.updateMany({
        where: owned(job),
        data: {
          status,
          claimToken: null,
          claimExpiresAt: null,
          lastErrorKind: error.kind,
          lastErrorMessage: error.message,
        },
      });
      return count === 1;
    },

    async nextWakeAt(environment) {
      const [pending, claimed] = await Promise.all([
        client.driveBackupJob.findFirst({
          where: { environment, status: 'PENDING' },
          orderBy: { nextAttemptAt: 'asc' },
          select: { nextAttemptAt: true },
        }),
        client.driveBackupJob.findFirst({
          where: { environment, status: 'IN_PROGRESS' },
          orderBy: { claimExpiresAt: 'asc' },
          select: { claimExpiresAt: true },
        }),
      ]);
      const times = [pending?.nextAttemptAt, claimed?.claimExpiresAt].filter(
        (value): value is Date => value instanceof Date,
      );
      return times.length ? new Date(Math.min(...times.map((time) => time.getTime()))) : null;
    },

    async readSource(fileAssetId) {
      return client.fileAsset.findUnique({
        where: { id: fileAssetId },
        select: {
          status: true,
          objectKey: true,
          mimeType: true,
          sizeBytes: true,
          category: true,
          createdAt: true,
        },
      });
    },

    async getFolder(path) {
      const row = await client.driveBackupFolder.findUnique({
        where: { path },
        select: { remoteFolderId: true },
      });
      return row?.remoteFolderId ?? null;
    },

    async insertFolderIfAbsent(path, remoteFolderId) {
      await client.driveBackupFolder.createMany({
        data: [{ path, remoteFolderId }],
        skipDuplicates: true,
      });
      const row = await client.driveBackupFolder.findUniqueOrThrow({
        where: { path },
        select: { remoteFolderId: true },
      });
      return row.remoteFolderId;
    },
  };
}
