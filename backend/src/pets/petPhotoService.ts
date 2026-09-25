import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { recordAuditLog } from '../auth/auditLog';
import {
  ForbiddenError,
  ObjectStorageNotConfiguredError,
  ObjectStorageUnavailableError,
  PetNotFoundError,
  PetPhotoInvalidError,
  PetPhotoNotFoundError,
} from '../errors/AppError';
import { getObjectStorage, type ObjectStorageClient } from '../lib/objectStorage';
import { prisma } from '../lib/prisma';
import type { PetActor, RequestMeta } from './petService';

/**
 * Foto de la ficha de una mascota (Etapa 5M) — docs/ARCHITECTURE.md §9.
 * El prototipo pedía una URL externa (`mascotas.foto`); ahora la imagen se
 * sube al backend, que valida el tipo REAL (bytes, no la extensión ni el
 * header), el tamaño y el permiso (solo ADMIN, como la edición de la ficha)
 * y la guarda en el bucket privado. En Postgres queda solo `FileAsset`
 * (`bucket` + `objectKey` generada por el backend) — nunca base64 ni URLs.
 *
 * Reemplazar o quitar la foto es una baja lógica (`PENDING_DELETION`) que
 * se confirma en la base antes de intentar el borrado físico del objeto; si
 * el borrado físico falla, la fila queda pendiente para reintentar.
 */

export const MAX_PET_PHOTO_BYTES = 5 * 1024 * 1024;

export const PET_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type PhotoMime = (typeof PET_PHOTO_MIME_TYPES)[number];
const EXTENSION: Record<PhotoMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Tipo real según la firma de los primeros bytes. */
export function detectImageMime(bytes: Buffer): PhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** Solo metadato (nunca se usa para la clave): sin rutas, sin control, acotado. */
export function sanitizeFilename(raw: string | undefined, fallback: string): string {
  let decoded = raw ?? '';
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // se usa tal cual
  }
  const base = decoded.split(/[\\/]/).pop() ?? '';
  const control = new RegExp(
    `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}<>]`,
    'g',
  );
  const clean = base.replace(control, '').trim().slice(0, 120);
  return clean || fallback;
}

function requireAdmin(actor: PetActor): void {
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede cambiar la foto de una mascota.');
  }
}

function requireStorage(): ObjectStorageClient {
  const storage = getObjectStorage();
  if (!storage) throw new ObjectStorageNotConfiguredError();
  return storage;
}

/** Borrado físico de objetos ya dados de baja lógicamente. Nunca lanza. */
async function purgeObjects(
  storage: ObjectStorageClient | null,
  files: readonly { id: string; objectKey: string }[],
): Promise<void> {
  if (!storage) return;
  for (const file of files) {
    try {
      await storage.deleteObject(file.objectKey);
      await prisma.fileAsset.updateMany({
        where: { id: file.id, status: 'PENDING_DELETION' },
        data: { status: 'DELETED' },
      });
    } catch (error) {
      console.error(
        'No se pudo borrar físicamente una foto (queda PENDING_DELETION):',
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** Bloquea la fila de la mascota: dos cambios de foto simultáneos se serializan. */
async function lockPet(tx: Prisma.TransactionClient, petId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "animals" WHERE "id" = ${petId}::uuid FOR UPDATE`,
  );
  if (rows.length === 0) throw new PetNotFoundError();
}

async function retireCurrentPhotos(
  tx: Prisma.TransactionClient,
  petId: string,
  keepId: string | null,
  now: Date,
) {
  const current = await tx.fileAsset.findMany({
    where: {
      animalId: petId,
      category: 'ANIMAL_PROFILE',
      status: 'AVAILABLE',
      ...(keepId ? { id: { not: keepId } } : {}),
    },
    select: { id: true, objectKey: true },
  });
  if (current.length) {
    await tx.fileAsset.updateMany({
      where: { id: { in: current.map((file) => file.id) }, status: 'AVAILABLE' },
      data: { status: 'PENDING_DELETION', deletedAt: now },
    });
  }
  return current;
}

export async function uploadPetPhoto(
  actor: PetActor,
  petId: string,
  input: { body: unknown; declaredType: string | undefined; filename: string | undefined },
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  const storage = requireStorage();
  const body = input.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new PetPhotoInvalidError('Elegí una imagen para subir.');
  }
  const mime = detectImageMime(body);
  const declared = input.declaredType?.split(';')[0]?.trim().toLowerCase();
  if (!mime || declared !== mime) throw new PetPhotoInvalidError();

  const pet = await prisma.animal.findUnique({ where: { id: petId }, select: { id: true } });
  if (!pet) throw new PetNotFoundError();

  const objectKey = `animals/${petId.toLowerCase()}/${randomUUID()}.${EXTENSION[mime]}`;
  const file = await prisma.fileAsset.create({
    data: {
      provider: 'NEON_OBJECT_STORAGE',
      bucket: storage.bucket,
      objectKey,
      originalFilename: sanitizeFilename(input.filename, `foto.${EXTENSION[mime]}`),
      mimeType: mime,
      sizeBytes: body.length,
      checksum: createHash('sha256').update(body).digest('hex'),
      category: 'ANIMAL_PROFILE',
      animalId: petId,
      uploadedByEmployeeId: actor.employeeId,
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

  let retired: { id: string; objectKey: string }[];
  try {
    retired = await prisma.$transaction(async (tx) => {
      await lockPet(tx, petId);
      const previous = await retireCurrentPhotos(tx, petId, file.id, now);
      await tx.fileAsset.update({
        where: { id: file.id },
        data: { status: 'AVAILABLE', etag: etag ?? null },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'pet.photo_updated',
        entityType: 'Animal',
        entityId: petId,
        previousState: { photoFileIds: previous.map((entry) => entry.id) },
        newState: { photoFileId: file.id, mimeType: mime, sizeBytes: body.length },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return previous;
    });
  } catch (error) {
    // La subida no quedó vinculada: el objeto nuevo se da de baja (lógica y física).
    await prisma.fileAsset.update({
      where: { id: file.id },
      data: { status: 'PENDING_DELETION', deletedAt: now },
    });
    await purgeObjects(storage, [{ id: file.id, objectKey }]);
    throw error;
  }
  await purgeObjects(storage, retired);
  return { photo: { id: file.id } };
}

/** "Quitar foto" (ADMIN): baja lógica confirmada y luego borrado físico. */
export async function removePetPhoto(
  actor: PetActor,
  petId: string,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  const retired = await prisma.$transaction(async (tx) => {
    await lockPet(tx, petId);
    const previous = await retireCurrentPhotos(tx, petId, null, now);
    if (previous.length) {
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'pet.photo_removed',
        entityType: 'Animal',
        entityId: petId,
        previousState: { photoFileIds: previous.map((entry) => entry.id) },
        newState: { photoFileId: null },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return previous;
  });
  await purgeObjects(getObjectStorage(), retired);
  return { photo: null };
}

/**
 * Proxy de lectura (todo usuario autenticado): el frontend nunca conoce el
 * bucket ni una URL firmada. Solo archivos disponibles de fichas de mascota.
 */
export async function readPetPhoto(fileId: string) {
  const storage = requireStorage();
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, status: 'AVAILABLE', category: 'ANIMAL_PROFILE', animalId: { not: null } },
    select: { objectKey: true, mimeType: true, checksum: true },
  });
  if (!file) throw new PetPhotoNotFoundError();
  let object;
  try {
    object = await storage.getObject(file.objectKey);
  } catch {
    throw new ObjectStorageUnavailableError();
  }
  if (!object) throw new PetPhotoNotFoundError();
  return { body: object.body, mimeType: file.mimeType, etag: file.checksum };
}
