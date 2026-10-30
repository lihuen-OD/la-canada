import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { recordAuditLog } from '../auth/auditLog';
import {
  ForbiddenError,
  IdempotencyKeyInvalidError,
  PhotoFolderNameTakenError,
  PhotoFolderNotEmptyError,
  PhotoFolderNotFoundError,
  PhotoFolderUnavailableError,
  PhotoFolderVersionConflictError,
  PhotoMoveConflictError,
  PhotoNotFoundError,
} from '../errors/AppError';
import { assertIdempotencyKey, canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import {
  photoFolderNameKey,
  type createPhotoFolderBodySchema,
  type deletePhotoFolderBodySchema,
  type movePhotoBodySchema,
  type renamePhotoFolderBodySchema,
} from './moreSchemas';
import {
  galleryWhere,
  lockLiveFolder,
  photoSelect,
  serializePhoto,
  storageStatus,
  type SerializedPhoto,
} from './photosService';

/**
 * 📸 Carpetas de Fotos (docs/BUSINESS_RULES.md, «Carpetas de Fotos»):
 * galería compartida organizada en carpetas de un solo nivel.
 *
 * - Crear y mover fotos: cualquier usuario activo (la sesión ya lo exige).
 * - Renombrar y eliminar: quien creó la carpeta o un ADMIN (rol de la base).
 * - Eliminar es lógico y solo con la carpeta vacía (sin fotos `AVAILABLE`):
 *   nunca borra ni mueve fotos; la fila queda para las eliminadas que la
 *   referencian (FK `RESTRICT`).
 * - Todo es organización en la base: ni el objeto del bucket, ni su clave,
 *   ni la copia en Drive cambian (y nada de esto encola copias).
 * - Concurrencia: renombre y eliminación con `version`; mover compara la
 *   carpeta que vio quien mueve; eliminar bloquea la fila (`FOR UPDATE`)
 *   antes de contar, y mover/confirmar una subida la bloquean (`FOR KEY
 *   SHARE`) antes de escribir: una carpeta eliminada nunca recibe fotos.
 */

type CreateFolderInput = z.infer<typeof createPhotoFolderBodySchema>;
type RenameFolderInput = z.infer<typeof renamePhotoFolderBodySchema>;
type DeleteFolderInput = z.infer<typeof deletePhotoFolderBodySchema>;
type MovePhotoInput = z.infer<typeof movePhotoBodySchema>;

const CREATE_ENDPOINT = 'POST /photos/folders';

const folderSelect = {
  id: true,
  name: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
} as const;
type FolderRow = Prisma.PhotoFolderGetPayload<{ select: typeof folderSelect }>;

/** Capacidades que la pantalla usa para mostrar solo las acciones autorizadas. */
export function photoFolderPermissions(actor: TaskActor, createdByUserId: string) {
  const allowed = actor.role === 'ADMIN' || actor.userId === createdByUserId;
  return { canRename: allowed, canDelete: allowed };
}

const nameCollator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/**
 * Orden por nombre en español («Carpeta 2» antes que «Carpeta 10», sin
 * distinguir mayúsculas ni tildes) con desempate estable: nombre exacto y,
 * por último, id. El frontend reordena con el mismo criterio al renombrar.
 */
export function comparePhotoFolders(
  left: { name: string; id: string },
  right: { name: string; id: string },
): number {
  return (
    nameCollator.compare(left.name, right.name) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function serializeFolder(actor: TaskActor, row: FolderRow, photoCount: number) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    photoCount,
    permissions: photoFolderPermissions(actor, row.createdByUserId),
  };
}

export type SerializedPhotoFolder = ReturnType<typeof serializeFolder>;

/**
 * Dentro de una transacción de carpetas el único índice único que puede
 * fallar es el del nombre vigente: la reserva de idempotencia la resuelve
 * `executeIdempotent` y los ids son UUID generados.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const countFolderPhotos = (client: Prisma.TransactionClient, folderId: string) =>
  client.fileAsset.count({ where: { ...galleryWhere(), folderId } });

/**
 * Pantalla principal de Fotos: carpetas vigentes ordenadas por nombre con la
 * cantidad de fotos visibles de cada una, «Sin carpeta» y «Todas las fotos».
 * DOS sentencias fijas en paralelo (carpetas + un `GROUP BY folder_id`),
 * sin importar cuántas carpetas haya: ninguna consulta por tarjeta ni
 * lectura de imágenes.
 */
export async function listPhotoFolders(actor: TaskActor) {
  const [folders, groups] = await Promise.all([
    prisma.photoFolder.findMany({ where: { deletedAt: null }, select: folderSelect }),
    prisma.fileAsset.groupBy({
      by: ['folderId'],
      where: galleryWhere(),
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(groups.map((group) => [group.folderId, group._count._all]));
  const total = groups.reduce((sum, group) => sum + group._count._all, 0);
  return {
    folders: [...folders]
      .sort(comparePhotoFolders)
      .map((row) => serializeFolder(actor, row, counts.get(row.id) ?? 0)),
    unfiled: { photoCount: counts.get(null) ?? 0 },
    all: { photoCount: total },
    photoStorage: storageStatus(),
  };
}

export type CreatePhotoFolderResult =
  | { kind: 'created'; body: { folder: SerializedPhotoFolder } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/**
 * «Nueva carpeta» (ADMIN y EMPLOYEE activos). Autor = usuario de la sesión.
 * `Idempotency-Key` obligatoria: un doble clic o un reintento del mismo
 * envío nunca crea dos carpetas. Dos altas simultáneas con el mismo nombre
 * efectivo: una 201 y la otra 409 (único parcial de la base).
 */
export async function createPhotoFolder(
  actor: TaskActor,
  input: CreateFolderInput,
  meta: RequestMeta,
  idempotencyKey: string | undefined,
): Promise<CreatePhotoFolderResult> {
  if (idempotencyKey === undefined) throw new IdempotencyKeyInvalidError();
  assertIdempotencyKey(idempotencyKey);
  const nameKey = photoFolderNameKey(input.name);
  try {
    return await executeIdempotent({
      actorUserId: actor.userId,
      endpoint: CREATE_ENDPOINT,
      key: idempotencyKey,
      requestHash: canonicalRequestHash([CREATE_ENDPOINT, input.name]),
      status: 201,
      run: async (tx) => {
        const taken = await tx.photoFolder.findFirst({
          where: { nameKey, deletedAt: null },
          select: { id: true },
        });
        if (taken) throw new PhotoFolderNameTakenError();
        const row = await tx.photoFolder.create({
          data: { name: input.name, nameKey, createdByUserId: actor.userId },
          select: folderSelect,
        });
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'photo_folder.created',
          entityType: 'PhotoFolder',
          entityId: row.id,
          newState: { name: row.name, version: row.version },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
        return { folder: serializeFolder(actor, row, 0) };
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PhotoFolderNameTakenError();
    throw error;
  }
}

/**
 * Renombrar (creador o ADMIN). El mismo nombre efectivo no escribe ni
 * audita (aunque la pantalla tuviera una versión vieja: no hay nada que
 * pisar). Cambiar solo mayúsculas es un cambio real.
 */
export async function renamePhotoFolder(
  actor: TaskActor,
  folderId: string,
  input: RenameFolderInput,
  meta: RequestMeta,
) {
  const nameKey = photoFolderNameKey(input.name);
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.photoFolder.findFirst({
        where: { id: folderId, deletedAt: null },
        select: { ...folderSelect, nameKey: true },
      });
      if (!current) throw new PhotoFolderNotFoundError();
      if (!photoFolderPermissions(actor, current.createdByUserId).canRename) {
        throw new ForbiddenError(
          'Solo quien creó esta carpeta o un administrador pueden renombrarla.',
        );
      }
      if (current.name === input.name) {
        return { folder: serializeFolder(actor, current, await countFolderPhotos(tx, folderId)) };
      }
      if (current.version !== input.version) throw new PhotoFolderVersionConflictError();
      if (nameKey !== current.nameKey) {
        const taken = await tx.photoFolder.findFirst({
          where: { nameKey, deletedAt: null, NOT: { id: folderId } },
          select: { id: true },
        });
        if (taken) throw new PhotoFolderNameTakenError();
      }
      const { count } = await tx.photoFolder.updateMany({
        where: { id: folderId, version: input.version, deletedAt: null },
        data: { name: input.name, nameKey, version: { increment: 1 } },
      });
      if (count === 0) {
        // Otra transacción ya confirmada ganó: se informa sin pisarla.
        const after = await tx.photoFolder.findUnique({
          where: { id: folderId },
          select: { deletedAt: true },
        });
        throw after?.deletedAt
          ? new PhotoFolderNotFoundError()
          : new PhotoFolderVersionConflictError();
      }
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'photo_folder.renamed',
        entityType: 'PhotoFolder',
        entityId: folderId,
        previousState: { name: current.name, version: current.version },
        newState: { name: input.name, version: current.version + 1 },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      const renamed = { ...current, name: input.name, version: current.version + 1 };
      return { folder: serializeFolder(actor, renamed, await countFolderPhotos(tx, folderId)) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new PhotoFolderNameTakenError();
    throw error;
  }
}

/**
 * Eliminar (creador o ADMIN), solo vacía. LÓGICA: la fila queda para las
 * fotos eliminadas que la referencian y su nombre vuelve a estar libre.
 * La fila se bloquea (`FOR UPDATE`) ANTES de contar: un movimiento o una
 * subida que la bloqueó primero ya está contada; uno posterior la encuentra
 * eliminada. Repetirla responde lo mismo sin escribir ni auditar.
 */
export async function deletePhotoFolder(
  actor: TaskActor,
  folderId: string,
  input: DeleteFolderInput,
  meta: RequestMeta,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<
      {
        name: string;
        version: number;
        created_by_user_id: string;
        deleted_at: Date | null;
      }[]
    >(
      Prisma.sql`SELECT "name", "version", "created_by_user_id", "deleted_at" FROM "photo_folders" WHERE "id" = ${folderId}::uuid FOR UPDATE`,
    );
    if (!current) throw new PhotoFolderNotFoundError();
    if (!photoFolderPermissions(actor, current.created_by_user_id).canDelete) {
      throw new ForbiddenError(
        'Solo quien creó esta carpeta o un administrador pueden eliminarla.',
      );
    }
    const result = { folder: { id: folderId, deleted: true as const } };
    if (current.deleted_at) return result;
    if (current.version !== input.version) throw new PhotoFolderVersionConflictError();
    if ((await countFolderPhotos(tx, folderId)) > 0) throw new PhotoFolderNotEmptyError();
    await tx.photoFolder.update({
      where: { id: folderId },
      data: { deletedAt: now, deletedByUserId: actor.userId, version: { increment: 1 } },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'photo_folder.deleted',
      entityType: 'PhotoFolder',
      entityId: folderId,
      previousState: { name: current.name, version: current.version, deleted: false },
      newState: {
        deleted: true,
        version: current.version + 1,
        createdByUserId: current.created_by_user_id,
        moderated: current.created_by_user_id !== actor.userId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result;
  });
}

/**
 * «Mover a carpeta» (cualquier usuario activo, una foto visible por vez).
 * Cambia SOLO `folder_id`: id, autor, fecha, tipo, título, persona y
 * vínculos quedan iguales y el objeto del bucket no se toca. Al destino
 * actual no escribe ni audita. Si la foto ya no está en `fromFolderId`
 * (otra persona la movió), 409 sin pisar ese movimiento.
 */
export async function movePhoto(
  actor: TaskActor,
  photoId: string,
  input: MovePhotoInput,
  meta: RequestMeta,
): Promise<{ photo: SerializedPhoto; moved: boolean }> {
  return prisma.$transaction(async (tx) => {
    const photo = await tx.fileAsset.findFirst({
      where: { id: photoId, ...galleryWhere() },
      select: photoSelect,
    });
    if (!photo) throw new PhotoNotFoundError();
    if (photo.folderId === input.folderId) return { photo: serializePhoto(photo), moved: false };
    if (photo.folderId !== input.fromFolderId) throw new PhotoMoveConflictError();
    if (input.folderId && !(await lockLiveFolder(tx, input.folderId))) {
      throw new PhotoFolderUnavailableError();
    }
    const { count } = await tx.fileAsset.updateMany({
      where: { id: photoId, status: 'AVAILABLE', folderId: input.fromFolderId },
      data: { folderId: input.folderId },
    });
    if (count === 0) {
      const still = await tx.fileAsset.findFirst({
        where: { id: photoId, ...galleryWhere() },
        select: { id: true },
      });
      throw still ? new PhotoMoveConflictError() : new PhotoNotFoundError();
    }
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'photo.moved',
      entityType: 'FileAsset',
      entityId: photoId,
      previousState: { folderId: input.fromFolderId },
      newState: { folderId: input.folderId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { photo: serializePhoto({ ...photo, folderId: input.folderId }), moved: true };
  });
}
