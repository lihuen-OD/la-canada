import { createHash, randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import type { PhotoCategory } from '../generated/prisma/enums';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EmployeeInvalidError,
  ForbiddenError,
  IdempotencyKeyConflictError,
  IdempotencyRecordPendingError,
  ObjectStorageNotConfiguredError,
  ObjectStorageUnavailableError,
  PetPhotoInvalidError,
  PhotoNotFoundError,
} from '../errors/AppError';
import { toLocalDate } from '../lib/businessTime';
import { assertIdempotencyKey, canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { getObjectStorage, type ObjectStorageClient } from '../lib/objectStorage';
import { prisma } from '../lib/prisma';
import { detectImageMime, sanitizeFilename } from '../pets/petPhotoService';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type { uploadPhotoQuerySchema } from './moreSchemas';

/**
 * 📸 Fotos (docs/BUSINESS_RULES.md §18, docs/ARCHITECTURE.md §9). El
 * prototipo guardaba la imagen en base64 dentro de la tabla; ahora el backend
 * valida el tipo REAL (bytes), el tamaño y los metadatos, sube el archivo al
 * bucket privado y en Postgres queda solo `FileAsset` (`bucket` + `objectKey`
 * generada acá, título, tipo y persona etiquetada).
 *
 * Permisos: ver y subir = todo usuario autenticado (paridad). Eliminar = solo
 * ADMIN — diferencia deliberada con el prototipo (que dejaba borrar a
 * cualquiera): es irreversible y ya estaba aprobada (docs/ARCHITECTURE.md §7).
 * Eliminar es baja lógica confirmada y luego borrado físico; un fallo del
 * borrado físico deja la fila `PENDING_DELETION` para `reconcileFileAssets`.
 */

export const MAX_GALLERY_PHOTO_BYTES = 10 * 1024 * 1024;
export const GALLERY_CATEGORY_LIST: readonly PhotoCategory[] = ['TASK_EVIDENCE', 'MEMORY'];
const UPLOAD_ENDPOINT = 'POST /photos';
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const KEY_PREFIX: Record<string, string> = {
  MEMORY: 'memories',
  TASK_EVIDENCE: 'task-evidence',
};

type UploadMetadata = z.infer<typeof uploadPhotoQuerySchema>;

const photoSelect = {
  id: true,
  title: true,
  category: true,
  createdAt: true,
  taggedEmployee: { select: { id: true, displayName: true, colorHex: true } },
} as const;
type PhotoRow = Prisma.FileAssetGetPayload<{ select: typeof photoSelect }>;

function serializePhoto(row: PhotoRow) {
  return {
    id: row.id,
    title: row.title ?? 'Sin título',
    category: row.category as 'TASK_EVIDENCE' | 'MEMORY',
    createdAt: row.createdAt.toISOString(),
    employee: row.taggedEmployee,
  };
}

export type SerializedPhoto = ReturnType<typeof serializePhoto>;

const storageStatus = () => (getObjectStorage() ? 'configured' : 'unconfigured');

function requireStorage(): ObjectStorageClient {
  const storage = getObjectStorage();
  if (!storage) throw new ObjectStorageNotConfiguredError();
  return storage;
}

const galleryWhere = (category?: PhotoCategory): Prisma.FileAssetWhereInput => ({
  status: 'AVAILABLE',
  category: category ? category : { in: [...GALLERY_CATEGORY_LIST] },
});

/** Galería más reciente primero, filtrable por tipo. Dos sentencias fijas (más una por relación). */
export async function listPhotos(filters: {
  category?: PhotoCategory;
  page: number;
  pageSize: number;
}) {
  const where = galleryWhere(filters.category);
  const [total, rows] = await Promise.all([
    prisma.fileAsset.count({ where }),
    prisma.fileAsset.findMany({
      where,
      select: photoSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return {
    photos: rows.map(serializePhoto),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    photoStorage: storageStatus(),
  };
}

export async function countPhotos() {
  return prisma.fileAsset.count({ where: galleryWhere() });
}

/** Borrado físico de objetos ya dados de baja lógicamente. Nunca lanza. */
async function purgeObjects(
  storage: ObjectStorageClient | null,
  files: readonly { id: string; objectKey: string }[],
): Promise<number> {
  if (!storage) return 0;
  let purged = 0;
  for (const file of files) {
    try {
      await storage.deleteObject(file.objectKey);
      const { count } = await prisma.fileAsset.updateMany({
        where: { id: file.id, status: 'PENDING_DELETION' },
        data: { status: 'DELETED' },
      });
      purged += count;
    } catch (error) {
      console.error(
        'No se pudo borrar físicamente una foto (queda PENDING_DELETION):',
        error instanceof Error ? error.message : error,
      );
    }
  }
  return purged;
}

/** El objeto subido no quedó vinculado a una foto disponible: baja lógica y física. */
async function discardUpload(
  storage: ObjectStorageClient,
  file: { id: string; objectKey: string },
  now: Date,
): Promise<void> {
  await prisma.fileAsset.updateMany({
    where: { id: file.id, status: { in: ['PENDING_UPLOAD', 'AVAILABLE'] } },
    data: { status: 'PENDING_DELETION', deletedAt: now },
  });
  await purgeObjects(storage, [file]);
}

export type UploadPhotoResult =
  | { kind: 'created'; body: { photo: SerializedPhoto } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/**
 * "Guardar foto" (todo usuario autenticado). Con `Idempotency-Key`, el mismo
 * envío (misma imagen y metadatos) nunca crea dos fotos: si ya se completó se
 * responde el original sin volver a subir; si una carrera lo resuelve después
 * de subir, el objeto sobrante se descarta.
 */
export async function uploadPhoto(
  actor: TaskActor,
  input: { body: unknown; declaredType: string | undefined; filename: string | undefined },
  metadata: UploadMetadata,
  meta: RequestMeta,
  idempotencyKey?: string,
  now = new Date(),
): Promise<UploadPhotoResult> {
  const storage = requireStorage();
  if (idempotencyKey !== undefined) assertIdempotencyKey(idempotencyKey);
  const body = input.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new PetPhotoInvalidError('Elegí una imagen para subir.');
  }
  const mime = detectImageMime(body);
  const declared = input.declaredType?.split(';')[0]?.trim().toLowerCase();
  if (!mime || declared !== mime) throw new PetPhotoInvalidError();
  const checksum = createHash('sha256').update(body).digest('hex');
  const employeeId = metadata.employeeId?.toLowerCase() ?? null;
  const requestHash = canonicalRequestHash([
    UPLOAD_ENDPOINT,
    checksum,
    metadata.category,
    employeeId,
    metadata.title,
  ]);

  if (idempotencyKey !== undefined) {
    // Reintento de un envío ya resuelto: se responde sin volver a subir.
    const record = await prisma.idempotencyRecord.findUnique({
      where: {
        actorUserId_endpoint_key: {
          actorUserId: actor.userId,
          endpoint: UPLOAD_ENDPOINT,
          key: idempotencyKey,
        },
      },
    });
    if (record) {
      if (record.requestHash !== requestHash) throw new IdempotencyKeyConflictError();
      if (record.responseStatus === null || record.responseBody === null || !record.completedAt) {
        throw new IdempotencyRecordPendingError();
      }
      return { kind: 'replay', status: record.responseStatus, body: record.responseBody };
    }
  }

  if (employeeId) {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { active: true },
    });
    if (!employee?.active) throw new EmployeeInvalidError();
  }

  const year = toLocalDate(now, config.businessTimeZone).year;
  const extension = EXTENSION[mime] ?? 'bin';
  const objectKey = `${KEY_PREFIX[metadata.category]}/${year}/${randomUUID()}.${extension}`;
  const file = await prisma.fileAsset.create({
    data: {
      provider: 'NEON_OBJECT_STORAGE',
      bucket: storage.bucket,
      objectKey,
      originalFilename: sanitizeFilename(input.filename, `foto.${extension}`),
      title: metadata.title,
      mimeType: mime,
      sizeBytes: body.length,
      checksum,
      category: metadata.category,
      uploadedByEmployeeId: actor.employeeId,
      taggedEmployeeId: employeeId,
    },
    select: { id: true },
  });

  let etag: string | null;
  try {
    ({ etag } = await storage.putObject(objectKey, body, mime));
  } catch {
    await prisma.fileAsset.update({ where: { id: file.id }, data: { status: 'UPLOAD_FAILED' } });
    throw new ObjectStorageUnavailableError();
  }

  const confirm = async (tx: Prisma.TransactionClient) => {
    const { count } = await tx.fileAsset.updateMany({
      where: { id: file.id, status: 'PENDING_UPLOAD' },
      data: { status: 'AVAILABLE', etag: etag ?? null },
    });
    if (count === 0) throw new PhotoNotFoundError();
    const row = await tx.fileAsset.findUniqueOrThrow({
      where: { id: file.id },
      select: photoSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'photo.uploaded',
      entityType: 'FileAsset',
      entityId: file.id,
      newState: {
        category: metadata.category,
        taggedEmployeeId: employeeId,
        mimeType: mime,
        sizeBytes: body.length,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { photo: serializePhoto(row) };
  };

  try {
    if (idempotencyKey === undefined) {
      return { kind: 'created', body: await prisma.$transaction(confirm) };
    }
    const result = await executeIdempotent({
      actorUserId: actor.userId,
      endpoint: UPLOAD_ENDPOINT,
      key: idempotencyKey,
      requestHash,
      status: 201,
      run: confirm,
    });
    // Otra solicitud con la misma clave ganó la carrera: este objeto sobra.
    if (result.kind === 'replay') await discardUpload(storage, { id: file.id, objectKey }, now);
    return result;
  } catch (error) {
    await discardUpload(storage, { id: file.id, objectKey }, now);
    throw error;
  }
}

/** "🗑 Eliminar" (solo ADMIN): baja lógica auditada y luego borrado físico. */
export async function deletePhoto(
  actor: TaskActor,
  photoId: string,
  meta: RequestMeta,
  now = new Date(),
) {
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede eliminar fotos.');
  }
  const file = await prisma.$transaction(async (tx) => {
    const existing = await tx.fileAsset.findFirst({
      where: { id: photoId, ...galleryWhere() },
      select: { id: true, objectKey: true, category: true, taggedEmployeeId: true },
    });
    if (!existing) throw new PhotoNotFoundError();
    const { count } = await tx.fileAsset.updateMany({
      where: { id: photoId, status: 'AVAILABLE' },
      data: { status: 'PENDING_DELETION', deletedAt: now },
    });
    if (count === 0) throw new PhotoNotFoundError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'photo.deleted',
      entityType: 'FileAsset',
      entityId: photoId,
      previousState: {
        category: existing.category,
        taggedEmployeeId: existing.taggedEmployeeId,
        status: 'AVAILABLE',
      },
      newState: { status: 'PENDING_DELETION' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return existing;
  });
  await purgeObjects(getObjectStorage(), [file]);
  return { photo: { id: photoId, deleted: true } };
}

/** Metadatos de una foto de la galería legible (para ETag/304 antes de leer el objeto). */
export async function findReadablePhoto(photoId: string) {
  requireStorage();
  const file = await prisma.fileAsset.findFirst({
    where: { id: photoId, ...galleryWhere() },
    select: { objectKey: true, mimeType: true, checksum: true },
  });
  if (!file) throw new PhotoNotFoundError();
  return file;
}

/** Proxy de lectura: el frontend nunca conoce el bucket, la clave ni una URL firmada. */
export async function readPhotoObject(objectKey: string) {
  const storage = requireStorage();
  let object;
  try {
    object = await storage.getObject(objectKey);
  } catch {
    throw new ObjectStorageUnavailableError();
  }
  if (!object) throw new PhotoNotFoundError();
  return object.body;
}

/**
 * Detección y compensación de huérfanos (docs/ARCHITECTURE.md §9.6), para el
 * script `storage:reconcile`. Sin `apply`, solo informa. Con `apply`:
 * reintenta el borrado físico de `PENDING_DELETION` y descarta (baja lógica +
 * borrado del objeto, si llegó a existir) las subidas que quedaron
 * `PENDING_UPLOAD`/`UPLOAD_FAILED` hace más de una hora. Nunca toca archivos
 * `AVAILABLE`.
 */
export async function reconcileFileAssets(options: { apply: boolean }, now = new Date()) {
  const staleBefore = new Date(now.getTime() - 60 * 60_000);
  const [pendingDeletion, staleUploads] = await Promise.all([
    prisma.fileAsset.findMany({
      where: { status: 'PENDING_DELETION' },
      select: { id: true, objectKey: true },
    }),
    prisma.fileAsset.findMany({
      where: {
        status: { in: ['PENDING_UPLOAD', 'UPLOAD_FAILED'] },
        createdAt: { lt: staleBefore },
      },
      select: { id: true, objectKey: true },
    }),
  ]);
  let purged = 0;
  if (options.apply) {
    const storage = getObjectStorage();
    if (staleUploads.length) {
      await prisma.fileAsset.updateMany({
        where: {
          id: { in: staleUploads.map((file) => file.id) },
          status: { in: ['PENDING_UPLOAD', 'UPLOAD_FAILED'] },
        },
        data: { status: 'PENDING_DELETION', deletedAt: now },
      });
    }
    purged = await purgeObjects(storage, [...pendingDeletion, ...staleUploads]);
  }
  return {
    pendingDeletion: pendingDeletion.length,
    staleUploads: staleUploads.length,
    purged,
    applied: options.apply,
  };
}
