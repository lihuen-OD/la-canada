import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import { resolveVisibleName } from '../auth/authService';
import {
  ForbiddenError,
  GardenPlanVersionNotFoundError,
  IdempotencyKeyConflictError,
  IdempotencyRecordPendingError,
  ObjectStorageNotConfiguredError,
  ObjectStorageUnavailableError,
  PetPhotoInvalidError,
  PetPhotoTooLargeError,
} from '../errors/AppError';
import { toLocalDate } from '../lib/businessTime';
import { assertIdempotencyKey, canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { getObjectStorage, type ObjectStorageClient } from '../lib/objectStorage';
import { prisma } from '../lib/prisma';
import { userIdentitySelect } from '../lib/userIdentity';
import { detectImageMime, sanitizeFilename } from '../pets/petPhotoService';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';

/**
 * 🌳 Jardín — historial de versiones del plano (Etapa 5Y,
 * docs/ARCHITECTURE.md §30). Módulo NUEVO: el prototipo no tenía esta pantalla,
 * así que no hay reglas heredadas ni datos que migrar; arranca vacío.
 *
 * Modelo mental, en tres reglas que el schema garantiza solo:
 * 1. Cada publicación crea una FILA nueva. No hay edición, ni borrado, ni
 *    restauración: las versiones son inmutables y el historial nunca se recorta.
 * 2. La versión vigente es la de `versionNumber` más alto. No hay columna
 *    `current`: "como máximo una vigente" es una consecuencia del orden, y
 *    publicar de nuevo deja intacta la anterior.
 * 3. Cada versión tiene su propio archivo privado (`FileAsset` 1 a 1 con FK
 *    `RESTRICT`): ni el bucket ni la clave salen alguna vez al cliente.
 *
 * Permisos: ver el plano y el historial = todo usuario autenticado (paridad
 * con 📸 Fotos, que también era visible para todos). Publicar = solo ADMIN —
 * es la única acción de escritura del módulo y la que deja una versión nueva
 * en el historial, así que exige el mismo permiso que el resto de la
 * configuración (ver docs/BUSINESS_RULES.md, "Jardín").
 */

export const MAX_GARDEN_PLAN_BYTES = 10 * 1024 * 1024;
const PUBLISH_ENDPOINT = 'POST /more/garden/versions';
const OBJECT_KEY_PREFIX = 'garden-plans';
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Llave del lock de aviso que serializa la numeración. Es un entero fijo
 * derivado del nombre del módulo, no de datos del usuario: dos publicaciones
 * simultáneas (del mismo ADMIN o de dos) se ordenan aquí en lugar de pelear
 * por el índice único de `version_number`.
 */
const VERSION_LOCK_KEY = 520026001;

const versionSelect = {
  id: true,
  versionNumber: true,
  createdAt: true,
  fileAsset: { select: { sizeBytes: true, mimeType: true } },
  publishedBy: { select: userIdentitySelect },
} as const;
type VersionRow = Prisma.GardenPlanVersionGetPayload<{ select: typeof versionSelect }>;

function serializeVersion(row: VersionRow) {
  return {
    id: row.id,
    versionNumber: row.versionNumber,
    createdAt: row.createdAt.toISOString(),
    sizeBytes: row.fileAsset.sizeBytes,
    mimeType: row.fileAsset.mimeType,
    // Nombre visible de quien publicó (Employee → Mi perfil → «Administrador»),
    // nunca su `username` técnico.
    publishedBy: resolveVisibleName(row.publishedBy),
  };
}

export type SerializedGardenPlanVersion = ReturnType<typeof serializeVersion>;

const storageStatus = () => (getObjectStorage() ? 'configured' : 'unconfigured');

function requireStorage(): ObjectStorageClient {
  const storage = getObjectStorage();
  if (!storage) throw new ObjectStorageNotConfiguredError();
  return storage;
}

/** Solo cuenta versiones cuyo archivo sigue `AVAILABLE` (los huérfanos no son historial). */
const availableVersion = { fileAsset: { is: { status: 'AVAILABLE' } } } as const;

/**
 * Historial paginado (más reciente primero) + la versión vigente, en UNA sola
 * lectura para la pantalla. Dos count y un findMany con su relación — la
 * vigente sale del mismo lote, así que abrir Jardín no hace una segunda
 * consulta por el plano actual.
 */
export async function listGardenPlanVersions(filters: { page: number; pageSize: number }) {
  const [total, rows] = await Promise.all([
    prisma.gardenPlanVersion.count({ where: availableVersion }),
    prisma.gardenPlanVersion.findMany({
      where: availableVersion,
      select: versionSelect,
      orderBy: { versionNumber: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  const latest = filters.page === 1 ? rows.at(0) : undefined;
  return {
    // `current`: la primera de la página 1 (orden descendente). En páginas
    // siguientes va `null` a propósito: la UI solo lo muestra arriba.
    current: latest ? serializeVersion(latest) : null,
    versions: rows.map(serializeVersion),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    gardenStorage: storageStatus(),
  };
}

export async function countGardenPlanVersions() {
  return prisma.gardenPlanVersion.count({ where: availableVersion });
}

/**
 * La versión pedida, si su archivo sigue disponible. Devuelve solo lo mínimo
 * para servir el proxy (clave, tipo y checksum): el frontend recibe el `id`
 * de la versión, nunca la clave del objeto.
 */
export async function findReadableGardenPlanVersion(versionId: string) {
  requireStorage();
  const version = await prisma.gardenPlanVersion.findFirst({
    where: { id: versionId, ...availableVersion },
    select: { fileAsset: { select: { objectKey: true, mimeType: true, checksum: true } } },
  });
  if (!version) throw new GardenPlanVersionNotFoundError();
  return version.fileAsset;
}

/** Proxy de lectura: el bucket, la clave y cualquier ruta quedan en el backend. */
export async function readGardenPlanObject(objectKey: string) {
  const storage = requireStorage();
  let object;
  try {
    object = await storage.getObject(objectKey);
  } catch {
    throw new ObjectStorageUnavailableError();
  }
  if (!object) throw new GardenPlanVersionNotFoundError();
  return object.body;
}

export type PublishGardenPlanVersionResult =
  | { kind: 'created'; body: { version: SerializedGardenPlanVersion } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/**
 * "Publicar nueva versión" (solo ADMIN). Sube el archivo al bucket privado y
 * lo enlaza a una versión nueva e inmutable.
 *
 * Con `Idempotency-Key`, el mismo envío (misma imagen) nunca publica dos
 * versiones: si ya se completó se responde el original sin volver a subir; si
 * una carrera con la misma clave lo resuelve después de subir, el objeto
 * sobrante se descarta (el `fileAsset` nunca llega a quedar `AVAILABLE`, así
 * que tampoco cuenta como historial).
 */
export async function publishGardenPlanVersion(
  actor: TaskActor,
  input: { body: unknown; declaredType: string | undefined; filename: string | undefined },
  meta: RequestMeta,
  idempotencyKey?: string,
  now = new Date(),
): Promise<PublishGardenPlanVersionResult> {
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede publicar una versión del plano.');
  }
  const storage = requireStorage();
  if (idempotencyKey !== undefined) assertIdempotencyKey(idempotencyKey);

  const body = input.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new PetPhotoInvalidError('Elegí una imagen del plano para publicar.');
  }
  if (body.length > MAX_GARDEN_PLAN_BYTES) {
    throw new PetPhotoTooLargeError(MAX_GARDEN_PLAN_BYTES / (1024 * 1024));
  }
  // Tipo por los BYTES: ni la extensión ni el `Content-Type` del cliente deciden.
  const mime = detectImageMime(body);
  const declared = input.declaredType?.split(';')[0]?.trim().toLowerCase();
  if (!mime || declared !== mime) throw new PetPhotoInvalidError();
  const checksum = createHash('sha256').update(body).digest('hex');
  const requestHash = canonicalRequestHash([PUBLISH_ENDPOINT, checksum]);

  if (idempotencyKey !== undefined) {
    // Reintento de un envío ya resuelto: se responde sin volver a subir.
    const record = await prisma.idempotencyRecord.findUnique({
      where: {
        actorUserId_endpoint_key: {
          actorUserId: actor.userId,
          endpoint: PUBLISH_ENDPOINT,
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

  const year = toLocalDate(now, config.businessTimeZone).year;
  const extension = EXTENSION[mime] ?? 'bin';
  const objectKey = `${OBJECT_KEY_PREFIX}/${year}/${randomUUID()}.${extension}`;
  const file = await prisma.fileAsset.create({
    data: {
      provider: 'NEON_OBJECT_STORAGE',
      bucket: storage.bucket,
      objectKey,
      originalFilename: sanitizeFilename(input.filename, `plano.${extension}`),
      mimeType: mime,
      sizeBytes: body.length,
      checksum,
      category: 'GARDEN_PLAN',
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

  const confirm = async (tx: Prisma.TransactionClient) => {
    // La numeración se calcula dentro de la transacción, después de tomar el
    // lock: dos publicaciones simultáneas se serializan acá y la segunda ve
    // el MAX ya confirmado. Sin esto, el índice único de `version_number`
    // convertiría una carrera en un 500 en vez de dos versiones correctas.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VERSION_LOCK_KEY})`;
    const latest = await tx.gardenPlanVersion.aggregate({ _max: { versionNumber: true } });
    const version = await tx.gardenPlanVersion.create({
      data: {
        versionNumber: (latest._max.versionNumber ?? 0) + 1,
        fileAssetId: file.id,
        publishedByUserId: actor.userId,
      },
      select: versionSelect,
    });
    const { count } = await tx.fileAsset.updateMany({
      where: { id: file.id, status: 'PENDING_UPLOAD' },
      data: { status: 'AVAILABLE', etag: etag ?? null },
    });
    if (count === 0) throw new GardenPlanVersionNotFoundError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'garden_plan.version_published',
      entityType: 'GardenPlanVersion',
      entityId: version.id,
      newState: {
        versionNumber: version.versionNumber,
        fileAssetId: file.id,
        mimeType: mime,
        sizeBytes: body.length,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { version: serializeVersion(version) };
  };

  try {
    if (idempotencyKey === undefined) {
      return { kind: 'created', body: await prisma.$transaction(confirm) };
    }
    const result = await executeIdempotent({
      actorUserId: actor.userId,
      endpoint: PUBLISH_ENDPOINT,
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

/** El objeto subido no quedó vinculado a una versión: baja lógica y borrado físico. */
async function discardUpload(
  storage: ObjectStorageClient,
  file: { id: string; objectKey: string },
  now: Date,
): Promise<void> {
  await prisma.fileAsset.updateMany({
    where: { id: file.id, status: { in: ['PENDING_UPLOAD', 'AVAILABLE'] } },
    data: { status: 'PENDING_DELETION', deletedAt: now },
  });
  try {
    await storage.deleteObject(file.objectKey);
    await prisma.fileAsset.updateMany({
      where: { id: file.id, status: 'PENDING_DELETION' },
      data: { status: 'DELETED' },
    });
  } catch (error) {
    console.error(
      'No se pudo borrar físicamente el archivo de una versión del plano (queda PENDING_DELETION):',
      error instanceof Error ? error.message : error,
    );
  }
}
