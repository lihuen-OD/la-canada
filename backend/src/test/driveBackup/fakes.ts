import { randomUUID } from 'node:crypto';
import type {
  DriveBackupEnvironment,
  FileStatus,
  PhotoCategory,
} from '../../generated/prisma/enums';
import type { DriveClient, DriveFileInfo, UploadInput } from '../../driveBackup/driveClient';
import { DriveBackupError } from '../../driveBackup/errors';
import type { ClaimedJob, DriveBackupStore, JobError, SourceFile } from '../../driveBackup/store';

/**
 * Dobles en memoria de la cola (misma semántica que la SQL real: reclamo con
 * vencimiento, token por fila, escrituras condicionadas al token) y de Drive
 * (IDs únicos: crear con un ID existente responde 409, como la API real).
 * La SQL de verdad se prueba contra `demo` en `driveBackup.integration.test.ts`.
 */

export interface MemoryJob {
  id: string;
  fileAssetId: string;
  environment: DriveBackupEnvironment;
  module: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SOURCE_MISSING';
  attempts: number;
  nextAttemptAt: Date;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  remoteFileId: string | null;
  remoteFolderId: string | null;
  lastErrorKind: string | null;
  lastErrorMessage: string | null;
  completedAt: Date | null;
}

export function memoryStore() {
  const jobs = new Map<string, MemoryJob>();
  const sources = new Map<string, SourceFile>();
  const folders = new Map<string, string>();

  const owns = (job: ClaimedJob) => {
    const row = jobs.get(job.id);
    return row && row.status === 'IN_PROGRESS' && row.claimToken === job.claimToken ? row : null;
  };
  const release = (row: MemoryJob) => {
    row.claimToken = null;
    row.claimExpiresAt = null;
  };

  const store: DriveBackupStore = {
    async claimDue(environment, now, limit, leaseMs) {
      const due = [...jobs.values()]
        .filter(
          (row) =>
            row.environment === environment &&
            ((row.status === 'PENDING' && row.nextAttemptAt <= now) ||
              (row.status === 'IN_PROGRESS' && row.claimExpiresAt! <= now)),
        )
        .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
        .slice(0, limit);
      return due.map((row) => {
        row.status = 'IN_PROGRESS';
        row.claimToken = randomUUID();
        row.claimExpiresAt = new Date(now.getTime() + leaseMs);
        row.attempts += 1;
        return {
          id: row.id,
          fileAssetId: row.fileAssetId,
          environment: row.environment,
          module: row.module,
          attempts: row.attempts,
          remoteFileId: row.remoteFileId,
          claimToken: row.claimToken,
        };
      });
    },
    async saveRemoteFileId(job, remoteFileId) {
      const row = owns(job);
      if (!row || row.remoteFileId) return false;
      row.remoteFileId = remoteFileId;
      return true;
    },
    async complete(job, remoteFileId, remoteFolderId, now) {
      const row = owns(job);
      if (!row) return false;
      Object.assign(row, {
        status: 'COMPLETED',
        remoteFileId,
        remoteFolderId,
        completedAt: now,
        lastErrorKind: null,
        lastErrorMessage: null,
      });
      release(row);
      return true;
    },
    async reschedule(job, nextAttemptAt, error: JobError) {
      const row = owns(job);
      if (!row) return false;
      Object.assign(row, {
        status: 'PENDING',
        nextAttemptAt,
        lastErrorKind: error.kind,
        lastErrorMessage: error.message,
      });
      release(row);
      return true;
    },
    async finish(job, status, error) {
      const row = owns(job);
      if (!row) return false;
      Object.assign(row, { status, lastErrorKind: error.kind, lastErrorMessage: error.message });
      release(row);
      return true;
    },
    async nextWakeAt(environment) {
      const times = [...jobs.values()]
        .filter((row) => row.environment === environment)
        .flatMap((row) =>
          row.status === 'PENDING'
            ? [row.nextAttemptAt]
            : row.status === 'IN_PROGRESS'
              ? [row.claimExpiresAt!]
              : [],
        );
      return times.length ? new Date(Math.min(...times.map((time) => time.getTime()))) : null;
    },
    async readSource(fileAssetId) {
      return sources.get(fileAssetId) ?? null;
    },
    async getFolder(path) {
      return folders.get(path) ?? null;
    },
    async insertFolderIfAbsent(path, remoteFolderId) {
      if (!folders.has(path)) folders.set(path, remoteFolderId);
      return folders.get(path)!;
    },
  };

  function addPhoto(
    options: {
      environment?: DriveBackupEnvironment;
      module?: string;
      status?: FileStatus;
      category?: PhotoCategory;
      createdAt?: Date;
      sizeBytes?: number;
      nextAttemptAt?: Date;
    } = {},
  ) {
    const fileAssetId = randomUUID();
    sources.set(fileAssetId, {
      status: options.status ?? 'AVAILABLE',
      objectKey: `memories/2026/${randomUUID()}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: options.sizeBytes ?? 4,
      category: options.category ?? 'MEMORY',
      createdAt: options.createdAt ?? new Date('2026-10-01T02:30:00Z'),
    });
    const job: MemoryJob = {
      id: randomUUID(),
      fileAssetId,
      environment: options.environment ?? 'DEMO',
      module: options.module ?? 'fotos',
      status: 'PENDING',
      attempts: 0,
      nextAttemptAt: options.nextAttemptAt ?? new Date('2026-10-01T00:00:00Z'),
      claimToken: null,
      claimExpiresAt: null,
      remoteFileId: null,
      remoteFolderId: null,
      lastErrorKind: null,
      lastErrorMessage: null,
      completedAt: null,
    };
    jobs.set(job.id, job);
    return job;
  }

  return { store, jobs, sources, folders, addPhoto };
}

export interface FakeDriveFile extends DriveFileInfo {
  bytes: number;
}

/** Drive en memoria. `failNext` inyecta fallos; `loseResponseOnce` simula una respuesta perdida. */
export function fakeDrive(destinationId = 'shared-drive-root-1') {
  const files = new Map<string, FakeDriveFile>();
  let counter = 0;
  const failures: { op: keyof DriveClient; error: Error }[] = [];
  let loseNextUploadResponse = false;

  const take = (op: keyof DriveClient) => {
    const index = failures.findIndex((failure) => failure.op === op);
    if (index >= 0) {
      const [failure] = failures.splice(index, 1);
      throw failure!.error;
    }
  };

  async function readAll(body: ReadableStream<Uint8Array>): Promise<number> {
    let total = 0;
    const reader = body.getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      total += chunk.value.byteLength;
    }
    return total;
  }

  const client: DriveClient = {
    async generateId() {
      take('generateId');
      counter += 1;
      return `generated-id-${String(counter).padStart(4, '0')}`;
    },
    async getFile(id) {
      take('getFile');
      const file = files.get(id);
      return file ? { ...file } : null;
    },
    async findByAppProperty(key, value, options) {
      take('findByAppProperty');
      return [...files.values()].filter(
        (file) =>
          !file.trashed &&
          file.appProperties[key] === value &&
          (!options.parentId || file.parents.includes(options.parentId)) &&
          (!options.folder || file.mimeType === 'application/vnd.google-apps.folder'),
      );
    },
    async createFolder(input) {
      take('createFolder');
      if (files.has(input.id)) throw new DriveBackupError('conflict', 'Drive 409', 409);
      files.set(input.id, {
        id: input.id,
        name: input.name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [input.parentId],
        trashed: false,
        size: null,
        appProperties: input.appProperties,
        driveId: destinationId,
        bytes: 0,
      });
    },
    async uploadFile(input: UploadInput) {
      take('uploadFile');
      if (files.has(input.id)) {
        await input.body.cancel();
        throw new DriveBackupError('conflict', 'Drive 409', 409);
      }
      const bytes = await readAll(input.body);
      files.set(input.id, {
        id: input.id,
        name: input.name,
        mimeType: input.mimeType,
        parents: [input.parentId],
        trashed: false,
        size: bytes,
        appProperties: input.appProperties,
        driveId: destinationId,
        bytes,
      });
      if (loseNextUploadResponse) {
        loseNextUploadResponse = false;
        // El archivo quedó creado, pero la respuesta nunca llegó.
        throw Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
      }
    },
    async describeDestination(id) {
      return {
        kind: 'shared_drive_root',
        id,
        name: 'La Cañada',
        driveId: destinationId,
        canAddChildren: true,
        canListChildren: true,
        canDeleteChildren: false,
      };
    },
  };

  return {
    client,
    files,
    failNext(op: keyof DriveClient, error: Error) {
      failures.push({ op, error });
    },
    loseNextUploadResponse() {
      loseNextUploadResponse = true;
    },
    uploadedPhotos: () =>
      [...files.values()].filter((file) => file.mimeType !== 'application/vnd.google-apps.folder'),
    folderPaths: () =>
      [...files.values()]
        .filter((file) => file.mimeType === 'application/vnd.google-apps.folder')
        .map((file) => file.appProperties.laCanadaFolder),
  };
}

export const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new Blob([new Uint8Array(bytes)]).stream();
