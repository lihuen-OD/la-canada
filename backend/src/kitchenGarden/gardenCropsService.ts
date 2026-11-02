import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../auth/auditLog';
import { resolveVisibleName } from '../auth/authService';
import {
  ForbiddenError,
  GardenBatchArchivedError,
  GardenBatchChangedError,
  GardenBatchNotFoundError,
  GardenBatchWithoutSowingError,
  GardenCropRecordChangedError,
  GardenCropRecordNotFoundError,
  GardenCropRecordVoidedError,
  GardenSowingHasTransplantsError,
  ValidationError,
} from '../errors/AppError';
import { addDays, formatLocalDate, startOfLocalDay, toLocalDate } from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import {
  loadParticipantDirectory,
  userPublicSelect,
  type GardenActor,
  type GardenParticipantEntry,
  type GardenPerson,
  type RequestMeta,
} from './gardenParticipants';
import type {
  createSowingBodySchema,
  createTransplantBodySchema,
  listBatchesQuerySchema,
  listCropRecordsQuerySchema,
  updateBatchBodySchema,
  updateCropRecordBodySchema,
} from './gardenCropSchemas';

/**
 * 🥬 Huerta — cultivos y registros (docs/BUSINESS_RULES.md, «🥬 Huerta:
 * cultivos y registros»). Una TANDA es una siembra concreta de un cultivo y
 * guarda su seguimiento: la siembra (una vigente) y los trasplantes
 * (parciales, varios). Independiente de Tareas, Inicio y de las actividades
 * y el Desempeño de la Huerta: tablas, endpoints y caché propios.
 *
 * Permisos (con el rol y la participación leídos de la base): consultar,
 * todo usuario autenticado; registrar, corregir, anular, archivar y
 * reabrir, ADMIN y participantes ACTIVOS, también lo de otra persona.
 * Quien REALIZÓ el hecho (un participante elegido explícitamente) es
 * distinto del usuario que lo REGISTRÓ (siempre la sesión).
 *
 * Concurrencia: toda escritura de una tanda bloquea su fila (`FOR UPDATE`)
 * y recién después lee su estado, así que la siembra y sus trasplantes se
 * validan contra fechas confirmadas. Las correcciones llevan la `version`
 * que vio la pantalla (409 si cambió); sin cambios no se escribe ni audita.
 * Las altas aceptan `Idempotency-Key`. Nada se borra: se anula con motivo.
 */

type CreateSowingInput = z.infer<typeof createSowingBodySchema>;
type CreateTransplantInput = z.infer<typeof createTransplantBodySchema>;
type UpdateBatchInput = z.infer<typeof updateBatchBodySchema>;
type UpdateCropRecordInput = z.infer<typeof updateCropRecordBodySchema>;
type ListBatchesFilters = z.infer<typeof listBatchesQuerySchema>;
type ListCropRecordsFilters = z.infer<typeof listCropRecordsQuerySchema>;

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;

// ── Reglas puras ──────────────────────────────────────────────────────────

/** ADMIN o participante ACTIVO de la Huerta: registra, corrige y anula (también lo ajeno). */
export function canRecordCrops(actor: GardenActor): boolean {
  return actor.role === 'ADMIN' || actor.participantId !== null;
}

function requireCropWriter(actor: GardenActor): void {
  if (!canRecordCrops(actor)) {
    throw new ForbiddenError(
      'Solo un administrador o un participante activo de la Huerta puede registrar o corregir cultivos.',
    );
  }
}

/** Clave única de un cultivo: sin distinguir mayúsculas ni espacios. */
export function cropNameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('es-AR');
}

export type TransplantDueStatus = 'SCHEDULED' | 'DUE_TODAY' | 'PAST';

/**
 * Estado de la fecha prevista frente a «hoy» (fechas de calendario
 * `YYYY-MM-DD` de `BUSINESS_TIME_ZONE`): «Previsto para…», «Para hoy» o
 * «Fecha prevista pasada». Nunca dice que el trasplante ocurrió ni que el
 * cultivo se perdió: solo compara fechas.
 */
export function transplantDueStatus(
  expected: string | null,
  today: string,
): TransplantDueStatus | null {
  if (!expected) return null;
  return expected > today ? 'SCHEDULED' : expected === today ? 'DUE_TODAY' : 'PAST';
}

const dateText = (value: Date): string => value.toISOString().slice(0, 10);
const toDbDate = (text: string): Date => new Date(`${text}T00:00:00.000Z`);
/** `YYYY-MM-DD` → `dd/mm/aaaa` (mensajes). */
const display = (text: string) => `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}`;
const todayOf = (now: Date) => formatLocalDate(toLocalDate(now, config.businessTimeZone));
/** Inicio del próximo día de negocio: la pantalla revalida los estados recién ahí. */
const nextDayStartsAt = (now: Date) =>
  startOfLocalDay(addDays(toLocalDate(now, config.businessTimeZone), 1), config.businessTimeZone);

function assertNotFuture(performedOn: string, today: string): void {
  if (performedOn > today) throw new ValidationError('La fecha no puede ser futura.');
}

/** Cantidad con su unidad: semillas y plantines enteros; gramos con hasta 2 decimales. */
function assertWholeIfCounted(quantity: string | null, unit: string | null): void {
  if (
    quantity &&
    (unit === 'SEEDS' || unit === 'SEEDLINGS') &&
    !new Prisma.Decimal(quantity).isInteger()
  ) {
    throw new ValidationError(
      unit === 'SEEDS' ? 'Las semillas se cuentan enteras.' : 'Los plantines se cuentan enteros.',
    );
  }
}

// ── Lectura y serialización ───────────────────────────────────────────────

const recordSelect = {
  id: true,
  type: true,
  performedOn: true,
  performedByParticipantId: true,
  method: true,
  location: true,
  quantity: true,
  quantityUnit: true,
  notes: true,
  version: true,
  createdAt: true,
  recordedByUser: { select: userPublicSelect },
} as const;
type RecordRow = Prisma.KitchenGardenCropRecordGetPayload<{ select: typeof recordSelect }>;

const batchCoreSelect = {
  id: true,
  name: true,
  variety: true,
  notes: true,
  transplantPending: true,
  expectedTransplantDate: true,
  transplantsClosedAt: true,
  archivedAt: true,
  version: true,
  createdAt: true,
  crop: { select: { id: true, name: true } },
} as const;
type BatchCoreRow = Prisma.KitchenGardenBatchGetPayload<{ select: typeof batchCoreSelect }>;

/** Quien ya no está en el directorio (no ocurre: los participantes no se borran). */
const UNKNOWN_PERSON = (id: string): GardenPerson => ({
  id,
  displayName: 'Participante',
  colorHex: null,
});

function personOf(directory: Map<string, GardenParticipantEntry>, id: string): GardenPerson {
  return directory.get(id)?.person ?? UNKNOWN_PERSON(id);
}

function serializeRecord(row: RecordRow, directory: Map<string, GardenParticipantEntry>) {
  return {
    id: row.id,
    type: row.type,
    performedOn: dateText(row.performedOn),
    /** Quien REALIZÓ el hecho: nombre conservado aunque hoy no participe. */
    performedBy: personOf(directory, row.performedByParticipantId),
    /** El usuario que lo registró (la sesión), solo su nombre visible. */
    recordedBy: { displayName: resolveVisibleName(row.recordedByUser) },
    method: row.method,
    location: row.location,
    quantity: row.quantity?.toString() ?? null,
    quantityUnit: row.quantityUnit,
    notes: row.notes,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SerializedCropRecord = ReturnType<typeof serializeRecord>;

function serializePlan(row: BatchCoreRow, today: string) {
  const expectedDate = row.expectedTransplantDate ? dateText(row.expectedTransplantDate) : null;
  return {
    pending: row.transplantPending,
    expectedDate,
    status: row.transplantPending ? transplantDueStatus(expectedDate, today) : null,
    /** Alguien confirmó «No quedan trasplantes pendientes». */
    closedAt: row.transplantsClosedAt?.toISOString() ?? null,
  };
}

function serializeBatchCore(row: BatchCoreRow, today: string) {
  return {
    id: row.id,
    crop: row.crop,
    name: row.name,
    variety: row.variety,
    notes: row.notes,
    archived: row.archivedAt !== null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    transplantPlan: serializePlan(row, today),
  };
}

/** Lo que puede hacer quien mira (la pantalla oculta lo que el backend igual rechazaría). */
function viewerOf(actor: GardenActor) {
  return {
    canRecord: canRecordCrops(actor),
    /** Su participación activa: la pantalla la preselecciona como «quién lo hizo». */
    participantId: actor.participantId,
  };
}

const summarySelect = {
  ...batchCoreSelect,
  records: {
    where: { type: 'SOWING', voidedAt: null },
    select: {
      id: true,
      performedOn: true,
      method: true,
      location: true,
      performedByParticipantId: true,
    },
    take: 1,
  },
  _count: { select: { records: { where: { type: 'TRANSPLANT', voidedAt: null } } } },
} satisfies Prisma.KitchenGardenBatchSelect;
type SummaryRow = Prisma.KitchenGardenBatchGetPayload<{ select: typeof summarySelect }>;

function serializeSummary(
  row: SummaryRow,
  directory: Map<string, GardenParticipantEntry>,
  today: string,
) {
  const sowing = row.records[0];
  return {
    ...serializeBatchCore(row, today),
    sowing: sowing
      ? {
          id: sowing.id,
          performedOn: dateText(sowing.performedOn),
          method: sowing.method,
          location: sowing.location,
          performedBy: personOf(directory, sowing.performedByParticipantId),
        }
      : null,
    transplantCount: row._count.records,
  };
}

const detailSelect = {
  ...batchCoreSelect,
  transplantsClosedByUser: { select: userPublicSelect },
  records: {
    where: { voidedAt: null },
    select: recordSelect,
    orderBy: [{ performedOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.KitchenGardenBatchSelect;

/**
 * Ficha de una tanda: datos, lo previsto y el seguimiento cronológico de los
 * hechos VIGENTES (siembra y trasplantes; los anulados quedan en la base y
 * en la auditoría). Tres sentencias fijas, nunca una por registro.
 */
async function loadBatchDetail(client: Client, batchId: string, today: string) {
  const row = await client.kitchenGardenBatch.findUnique({
    where: { id: batchId },
    select: detailSelect,
  });
  if (!row) throw new GardenBatchNotFoundError();
  const directory = await loadParticipantDirectory(client);
  const records = row.records.map((record) => serializeRecord(record, directory));
  return {
    ...serializeBatchCore(row, today),
    transplantPlan: {
      ...serializePlan(row, today),
      closedBy: row.transplantsClosedByUser
        ? { displayName: resolveVisibleName(row.transplantsClosedByUser) }
        : null,
    },
    /** `null`: su siembra se anuló (la tanda ya no admite hechos nuevos). */
    sowing: records.find((record) => record.type === 'SOWING') ?? null,
    transplants: records.filter((record) => record.type === 'TRANSPLANT'),
  };
}

export type GardenBatchDetail = Awaited<ReturnType<typeof loadBatchDetail>>;

// ── Consultas ─────────────────────────────────────────────────────────────

/**
 * 🥕 Cultivos: tandas con siembra vigente (activas, archivadas o todas),
 * opcionalmente de un cultivo. Orden: primero las que tienen un trasplante
 * pendiente con fecha prevista (la más antigua arriba); después el resto, por
 * siembra más reciente; desempate estable por creación e id. Conteo + página
 * en Postgres y una sentencia por relación para toda la página.
 */
export async function listGardenBatches(
  actor: GardenActor,
  filters: ListBatchesFilters,
  now = new Date(),
) {
  const where = Prisma.sql`
    FROM "kitchen_garden_batches" b
    JOIN "kitchen_garden_crop_records" s
      ON s."batch_id" = b."id" AND s."type" = 'SOWING' AND s."voided_at" IS NULL
    WHERE TRUE
    ${filters.status === 'active' ? Prisma.sql`AND b."archived_at" IS NULL` : Prisma.empty}
    ${filters.status === 'archived' ? Prisma.sql`AND b."archived_at" IS NOT NULL` : Prisma.empty}
    ${filters.cropId ? Prisma.sql`AND b."crop_id" = ${filters.cropId}::uuid` : Prisma.empty}`;
  const [countRows, idRows, directory] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT count(*)::bigint AS "count" ${where}`),
    prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT b."id" ${where}
      ORDER BY (b."transplant_pending" AND b."expected_transplant_date" IS NOT NULL) DESC,
               b."expected_transplant_date" ASC NULLS LAST,
               s."performed_on" DESC,
               b."created_at" DESC,
               b."id" ASC
      LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`),
    loadParticipantDirectory(),
  ]);
  const ids = idRows.map((row) => row.id);
  const rows =
    ids.length === 0
      ? []
      : await prisma.kitchenGardenBatch.findMany({
          where: { id: { in: ids } },
          select: summarySelect,
        });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const today = todayOf(now);
  const total = Number(countRows[0]?.count ?? 0);
  return {
    batches: ids
      .map((id) => byId.get(id))
      .filter((row): row is SummaryRow => row !== undefined)
      .map((row) => serializeSummary(row, directory, today)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    today,
    generatedAt: now.toISOString(),
    refreshAt: nextDayStartsAt(now).toISOString(),
    viewer: viewerOf(actor),
  };
}

/** Ficha de una tanda (todo usuario autenticado). */
export async function getGardenBatch(actor: GardenActor, batchId: string, now = new Date()) {
  const today = todayOf(now);
  return {
    batch: await loadBatchDetail(prisma, batchId, today),
    today,
    generatedAt: now.toISOString(),
    viewer: viewerOf(actor),
  };
}

/**
 * Cultivos con al menos una tanda con siembra vigente, por nombre (español,
 * sin distinguir mayúsculas ni tildes): opciones de filtro y sugerencias al
 * registrar una siembra. Una sentencia.
 */
export async function listGardenCrops() {
  const crops = await prisma.kitchenGardenCrop.findMany({
    select: {
      id: true,
      name: true,
      _count: {
        select: { batches: { where: { records: { some: { type: 'SOWING', voidedAt: null } } } } },
      },
    },
  });
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
  return {
    crops: crops
      .filter((crop) => crop._count.batches > 0)
      .map((crop) => ({ id: crop.id, name: crop.name, batchCount: crop._count.batches }))
      .sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)),
  };
}

/**
 * 📝 Registros: siembras y trasplantes VIGENTES, más recientes primero
 * (fecha real, después momento de registro, id), con filtros por rango de
 * fechas, cultivo, tanda, tipo y persona. Conteo + página en Postgres
 * (índice `(performed_on, created_at)`), relaciones de la página en una
 * sentencia cada una y el directorio de participantes en otra.
 */
export async function listGardenCropRecords(
  actor: GardenActor,
  filters: ListCropRecordsFilters,
  now = new Date(),
) {
  const where: Prisma.KitchenGardenCropRecordWhereInput = {
    voidedAt: null,
    ...(filters.from || filters.to
      ? {
          performedOn: {
            ...(filters.from ? { gte: toDbDate(filters.from) } : {}),
            ...(filters.to ? { lte: toDbDate(filters.to) } : {}),
          },
        }
      : {}),
    ...(filters.batchId ? { batchId: filters.batchId } : {}),
    ...(filters.cropId ? { batch: { cropId: filters.cropId } } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.participantId ? { performedByParticipantId: filters.participantId } : {}),
  };
  const [total, rows, directory] = await Promise.all([
    prisma.kitchenGardenCropRecord.count({ where }),
    prisma.kitchenGardenCropRecord.findMany({
      where,
      select: {
        ...recordSelect,
        batch: {
          select: {
            id: true,
            name: true,
            archivedAt: true,
            crop: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ performedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    loadParticipantDirectory(),
  ]);
  return {
    records: rows.map((row) => ({
      ...serializeRecord(row, directory),
      batch: {
        id: row.batch.id,
        name: row.batch.name,
        crop: row.batch.crop,
        archived: row.batch.archivedAt !== null,
      },
    })),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    today: todayOf(now),
    viewer: viewerOf(actor),
  };
}

// ── Piezas de escritura ───────────────────────────────────────────────────

/** Bloquea la tanda hasta el fin de la transacción; el estado se lee DESPUÉS. */
async function lockBatch(tx: Tx, batchId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM "kitchen_garden_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`,
  );
  if (rows.length === 0) throw new GardenBatchNotFoundError();
}

/** Estado de la tanda ya bloqueada: fechas confirmadas de su siembra y trasplantes vigentes. */
async function readLockedBatch(tx: Tx, batchId: string) {
  const row = await tx.kitchenGardenBatch.findUniqueOrThrow({
    where: { id: batchId },
    select: {
      version: true,
      archivedAt: true,
      name: true,
      variety: true,
      notes: true,
      transplantPending: true,
      expectedTransplantDate: true,
      transplantsClosedAt: true,
      crop: { select: { id: true, name: true, nameKey: true } },
      records: {
        where: { voidedAt: null },
        select: { id: true, type: true, performedOn: true },
        orderBy: [{ performedOn: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const sowing = row.records.find((record) => record.type === 'SOWING');
  const transplants = row.records.filter((record) => record.type === 'TRANSPLANT');
  return {
    ...row,
    sowingDate: sowing ? dateText(sowing.performedOn) : null,
    sowingId: sowing?.id ?? null,
    transplantDates: transplants.map((record) => dateText(record.performedOn)),
    expected: row.expectedTransplantDate ? dateText(row.expectedTransplantDate) : null,
  };
}

/** La persona elegida tiene que participar HOY de la Huerta (su identidad histórica se conserva). */
async function requireActivePerformer(tx: Tx, participantId: string): Promise<void> {
  const row = await tx.kitchenGardenParticipant.findUnique({
    where: { id: participantId },
    select: { active: true },
  });
  if (!row?.active) throw new ValidationError('Elegí un participante activo de la Huerta.');
}

/**
 * Busca el cultivo por su clave o lo crea, sin carreras: `ON CONFLICT DO
 * NOTHING` sobre `name_key` (dos siembras simultáneas del mismo cultivo
 * comparten la fila). Se audita solo si se creó.
 */
async function findOrCreateCrop(tx: Tx, name: string, actor: GardenActor, meta: RequestMeta) {
  const nameKey = cropNameKey(name);
  const inserted = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "kitchen_garden_crops" ("id", "name", "name_key", "created_by_user_id")
    VALUES (gen_random_uuid(), ${name}, ${nameKey}, ${actor.userId}::uuid)
    ON CONFLICT ("name_key") DO NOTHING
    RETURNING "id"`);
  if (inserted[0]) {
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.crop_created',
      entityType: 'KitchenGardenCrop',
      entityId: inserted[0].id,
      newState: { name },
      ...meta,
    });
    return inserted[0].id;
  }
  const existing = await tx.kitchenGardenCrop.findUniqueOrThrow({
    where: { nameKey },
    select: { id: true },
  });
  return existing.id;
}

function assertWritable(batch: { archivedAt: Date | null; sowingDate: string | null }): string {
  if (batch.archivedAt) throw new GardenBatchArchivedError();
  if (!batch.sowingDate) throw new GardenBatchWithoutSowingError();
  return batch.sowingDate;
}

function assertNotBeforeSowing(date: string, sowingDate: string, label: string): void {
  if (date < sowingDate) {
    throw new ValidationError(
      `${label} no puede ser anterior a la siembra (${display(sowingDate)}).`,
    );
  }
}

/** Respuesta de una alta: idempotente con `Idempotency-Key`, transacción simple sin ella. */
export type GardenCreateResult =
  | { kind: 'created'; body: { batch: GardenBatchDetail } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

async function runCreate(
  actor: GardenActor,
  endpoint: string,
  hashParts: (string | number | null)[],
  idempotencyKey: string | undefined,
  write: (tx: Tx) => Promise<{ batch: GardenBatchDetail }>,
): Promise<GardenCreateResult> {
  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  const result = await executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([endpoint, ...hashParts]),
    status: 201,
    // La respuesta es JSON plano (las interfaces de personas no declaran
    // firma de índice, por eso la conversión de tipo explícita).
    run: async (tx) => (await write(tx)) as unknown as Prisma.InputJsonObject,
  });
  return result.kind === 'created'
    ? { kind: 'created', body: result.body as unknown as { batch: GardenBatchDetail } }
    : result;
}

// ── Siembra (alta de la tanda) ────────────────────────────────────────────

/**
 * «Registrar siembra»: la tanda y su siembra en UNA transacción. Fecha real
 * hoy o pasada; almácigo deja un trasplante pendiente (con fecha prevista
 * opcional, nunca anterior a la siembra); directa, ninguno.
 */
export async function createGardenSowing(
  actor: GardenActor,
  input: CreateSowingInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
): Promise<GardenCreateResult> {
  requireCropWriter(actor);
  const today = todayOf(now);
  assertNotFuture(input.performedOn, today);
  if (input.expectedTransplantDate) {
    assertNotBeforeSowing(
      input.expectedTransplantDate,
      input.performedOn,
      'La fecha prevista de trasplante',
    );
  }
  const quantity = input.quantity ?? null;
  const unit = input.quantityUnit ?? null;
  assertWholeIfCounted(quantity, unit);

  const write = async (tx: Tx) => {
    await requireActivePerformer(tx, input.performedByParticipantId);
    const cropId = await findOrCreateCrop(tx, input.cropName, actor, meta);
    const seedbed = input.method === 'SEEDBED';
    const batch = await tx.kitchenGardenBatch.create({
      data: {
        cropId,
        name: input.batchName,
        variety: input.variety ?? null,
        notes: input.batchNotes ?? null,
        transplantPending: seedbed,
        expectedTransplantDate:
          seedbed && input.expectedTransplantDate ? toDbDate(input.expectedTransplantDate) : null,
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    const sowing = await tx.kitchenGardenCropRecord.create({
      data: {
        batchId: batch.id,
        type: 'SOWING',
        performedOn: toDbDate(input.performedOn),
        performedByParticipantId: input.performedByParticipantId,
        recordedByUserId: actor.userId,
        method: input.method,
        location: input.location,
        quantity: quantity ? new Prisma.Decimal(quantity) : null,
        quantityUnit: unit,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.batch_sown',
      entityType: 'KitchenGardenBatch',
      entityId: batch.id,
      newState: {
        cropId,
        name: input.batchName,
        variety: input.variety ?? null,
        sowingRecordId: sowing.id,
        performedOn: input.performedOn,
        performedByParticipantId: input.performedByParticipantId,
        method: input.method,
        location: input.location,
        quantity,
        quantityUnit: unit,
        transplantPending: seedbed,
        expectedTransplantDate: seedbed ? (input.expectedTransplantDate ?? null) : null,
      },
      ...meta,
    });
    return { batch: await loadBatchDetail(tx, batch.id, today) };
  };

  return runCreate(
    actor,
    'POST /kitchen-garden/batches',
    [
      cropNameKey(input.cropName),
      input.batchName,
      input.variety ?? null,
      input.batchNotes ?? null,
      input.performedOn,
      input.performedByParticipantId.toLowerCase(),
      input.method,
      input.location,
      quantity,
      unit,
      input.notes ?? null,
      input.expectedTransplantDate ?? null,
    ],
    idempotencyKey,
    write,
  );
}

// ── Lo previsto para los trasplantes ──────────────────────────────────────

interface PlanState {
  pending: boolean;
  expected: string | null;
}

/**
 * Aplica lo previsto (si cambió): «No quedan trasplantes pendientes» guarda
 * quién y cuándo; volver a dejar pendientes lo limpia. La fecha prevista
 * solo existe con pendientes y nunca es anterior a la siembra. Devuelve si
 * hubo cambio (y entonces sube la versión de la tanda y audita).
 */
async function applyPlan(
  tx: Tx,
  batchId: string,
  current: PlanState,
  next: PlanState,
  sowingDate: string,
  actor: GardenActor,
  meta: RequestMeta,
  now: Date,
): Promise<boolean> {
  if (current.pending === next.pending && current.expected === next.expected) return false;
  if (next.expected)
    assertNotBeforeSowing(next.expected, sowingDate, 'La fecha prevista de trasplante');
  const closing = current.pending && !next.pending;
  await tx.kitchenGardenBatch.update({
    where: { id: batchId },
    data: {
      transplantPending: next.pending,
      expectedTransplantDate: next.expected ? toDbDate(next.expected) : null,
      ...(closing ? { transplantsClosedAt: now, transplantsClosedByUserId: actor.userId } : {}),
      ...(next.pending ? { transplantsClosedAt: null, transplantsClosedByUserId: null } : {}),
      version: { increment: 1 },
    },
  });
  await recordAuditLog(tx, {
    actorUserId: actor.userId,
    action: 'kitchen_garden.transplant_plan_updated',
    entityType: 'KitchenGardenBatch',
    entityId: batchId,
    previousState: { transplantPending: current.pending, expectedTransplantDate: current.expected },
    newState: {
      transplantPending: next.pending,
      expectedTransplantDate: next.expected,
      noTransplantsPending: closing,
    },
    ...meta,
  });
  return true;
}

// ── Trasplantes ───────────────────────────────────────────────────────────

/**
 * «Registrar trasplante» desde la ficha (también sin haberlo programado).
 * Fecha real hoy o pasada y nunca anterior a la siembra; varios parciales.
 * Lo que queda se decide de forma EXPLÍCITA (`remainingPending`): un
 * trasplante no cierra los pendientes por sí solo y una fecha prevista nunca
 * se convierte en un hecho. Si cambia lo previsto, la tanda tiene que seguir
 * siendo la que vio la pantalla (`batchVersion`).
 */
export async function createGardenTransplant(
  actor: GardenActor,
  batchId: string,
  input: CreateTransplantInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
): Promise<GardenCreateResult> {
  requireCropWriter(actor);
  const today = todayOf(now);
  assertNotFuture(input.performedOn, today);
  const quantity = input.quantity ?? null;

  const write = async (tx: Tx) => {
    await lockBatch(tx, batchId);
    const batch = await readLockedBatch(tx, batchId);
    const sowingDate = assertWritable(batch);
    assertNotBeforeSowing(input.performedOn, sowingDate, 'El trasplante');
    await requireActivePerformer(tx, input.performedByParticipantId);

    const next: PlanState = input.remainingPending
      ? {
          pending: true,
          expected:
            input.expectedTransplantDate === undefined
              ? batch.transplantPending
                ? batch.expected
                : null
              : input.expectedTransplantDate,
        }
      : { pending: false, expected: null };
    const planChanges =
      batch.transplantPending !== next.pending || batch.expected !== next.expected;
    if (planChanges && input.batchVersion !== batch.version) throw new GardenBatchChangedError();

    const record = await tx.kitchenGardenCropRecord.create({
      data: {
        batchId,
        type: 'TRANSPLANT',
        performedOn: toDbDate(input.performedOn),
        performedByParticipantId: input.performedByParticipantId,
        recordedByUserId: actor.userId,
        location: input.location,
        quantity: quantity ? new Prisma.Decimal(quantity) : null,
        quantityUnit: quantity ? 'SEEDLINGS' : null,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.transplant_recorded',
      entityType: 'KitchenGardenCropRecord',
      entityId: record.id,
      newState: {
        batchId,
        performedOn: input.performedOn,
        performedByParticipantId: input.performedByParticipantId,
        location: input.location,
        quantity,
        quantityUnit: quantity ? 'SEEDLINGS' : null,
      },
      ...meta,
    });
    await applyPlan(
      tx,
      batchId,
      { pending: batch.transplantPending, expected: batch.expected },
      next,
      sowingDate,
      actor,
      meta,
      now,
    );
    return { batch: await loadBatchDetail(tx, batchId, today) };
  };

  return runCreate(
    actor,
    `POST /kitchen-garden/batches/${batchId.toLowerCase()}/transplants`,
    [
      input.batchVersion,
      input.performedOn,
      input.performedByParticipantId.toLowerCase(),
      input.location,
      quantity,
      input.notes ?? null,
      input.remainingPending ? 'pending' : 'closed',
      input.expectedTransplantDate === undefined
        ? 'keep'
        : (input.expectedTransplantDate ?? 'none'),
    ],
    idempotencyKey,
    write,
  );
}

// ── Correcciones de la tanda ──────────────────────────────────────────────

/**
 * Corregir una tanda: cultivo, nombre, variedad, observaciones y lo previsto
 * para sus trasplantes. Archivada o sin siembra vigente: 409. Sin cambios:
 * no escribe ni audita. Si la tanda ya no es la `version` que vio la
 * pantalla, 409 sin pisar lo de otra persona.
 */
export async function updateGardenBatch(
  actor: GardenActor,
  batchId: string,
  input: UpdateBatchInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireCropWriter(actor);
  const today = todayOf(now);
  const changed = await prisma.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await readLockedBatch(tx, batchId);
    const sowingDate = assertWritable(batch);

    const fields: Record<string, { from: string | null; to: string | null }> = {};
    const note = (key: string, from: string | null, to: string | null | undefined) => {
      if (to !== undefined && from !== to) fields[key] = { from, to };
    };
    const cropChanges =
      input.cropName !== undefined && cropNameKey(input.cropName) !== batch.crop.nameKey;
    if (cropChanges) fields.crop = { from: batch.crop.name, to: input.cropName! };
    note('name', batch.name, input.name);
    note('variety', batch.variety, input.variety);
    note('notes', batch.notes, input.notes);

    const pendingNext = input.transplantPending ?? batch.transplantPending;
    let expectedNext =
      input.expectedTransplantDate !== undefined ? input.expectedTransplantDate : batch.expected;
    if (!pendingNext) {
      if (input.expectedTransplantDate) {
        throw new ValidationError('Sin trasplantes pendientes no hay fecha prevista.');
      }
      expectedNext = null;
    }
    const planChanges = pendingNext !== batch.transplantPending || expectedNext !== batch.expected;

    if (Object.keys(fields).length === 0 && !planChanges) return false;
    if (input.version !== batch.version) throw new GardenBatchChangedError();

    if (Object.keys(fields).length > 0) {
      const cropId = cropChanges
        ? await findOrCreateCrop(tx, input.cropName!, actor, meta)
        : undefined;
      await tx.kitchenGardenBatch.update({
        where: { id: batchId },
        data: {
          ...(cropId ? { cropId } : {}),
          ...('name' in fields ? { name: input.name } : {}),
          ...('variety' in fields ? { variety: input.variety ?? null } : {}),
          ...('notes' in fields ? { notes: input.notes ?? null } : {}),
          // Lo previsto sube la versión por su cuenta (`applyPlan`).
          ...(planChanges ? {} : { version: { increment: 1 } }),
        },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'kitchen_garden.batch_updated',
        entityType: 'KitchenGardenBatch',
        entityId: batchId,
        previousState: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, value.from]),
        ),
        newState: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.to])),
        ...meta,
      });
    }
    if (planChanges) {
      await applyPlan(
        tx,
        batchId,
        { pending: batch.transplantPending, expected: batch.expected },
        { pending: pendingNext, expected: expectedNext },
        sowingDate,
        actor,
        meta,
        now,
      );
    }
    return true;
  });
  return { batch: await loadBatchDetail(prisma, batchId, today), changed };
}

/**
 * Archivar o reabrir una tanda (sin borrar registros). Repetirlo no escribe
 * ni audita. Archivada se consulta, pero no admite hechos nuevos ni
 * correcciones hasta reabrirla.
 */
export async function setGardenBatchArchived(
  actor: GardenActor,
  batchId: string,
  archived: boolean,
  meta: RequestMeta,
  now = new Date(),
) {
  requireCropWriter(actor);
  const today = todayOf(now);
  const changed = await prisma.$transaction(async (tx) => {
    await lockBatch(tx, batchId);
    const batch = await readLockedBatch(tx, batchId);
    if (!batch.sowingDate) throw new GardenBatchWithoutSowingError();
    if ((batch.archivedAt !== null) === archived) return false;
    await tx.kitchenGardenBatch.update({
      where: { id: batchId },
      data: archived
        ? { archivedAt: now, archivedByUserId: actor.userId, version: { increment: 1 } }
        : { archivedAt: null, archivedByUserId: null, version: { increment: 1 } },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: archived ? 'kitchen_garden.batch_archived' : 'kitchen_garden.batch_reopened',
      entityType: 'KitchenGardenBatch',
      entityId: batchId,
      previousState: { archived: !archived },
      newState: { archived },
      ...meta,
    });
    return true;
  });
  return { batch: await loadBatchDetail(prisma, batchId, today), changed };
}

// ── Correcciones y anulación de registros ─────────────────────────────────

/** El registro y su tanda bloqueada (la tanda primero: mismo orden que las altas). */
async function lockRecord(tx: Tx, recordId: string) {
  const found = await tx.kitchenGardenCropRecord.findUnique({
    where: { id: recordId },
    select: { batchId: true },
  });
  if (!found) throw new GardenCropRecordNotFoundError();
  await lockBatch(tx, found.batchId);
  const record = await tx.kitchenGardenCropRecord.findUniqueOrThrow({
    where: { id: recordId },
    select: {
      id: true,
      batchId: true,
      type: true,
      performedOn: true,
      performedByParticipantId: true,
      method: true,
      location: true,
      quantity: true,
      quantityUnit: true,
      notes: true,
      version: true,
      voidedAt: true,
    },
  });
  const batch = await readLockedBatch(tx, record.batchId);
  return { record, batch };
}

/**
 * Corregir una siembra o un trasplante (ADMIN o participante activo, también
 * lo de otra persona). Conserva quién lo registró; la persona que lo realizó
 * cambia solo si se elige explícitamente otra (activa). Fechas: hoy o
 * pasadas; la siembra nunca después de un trasplante vigente ni de la fecha
 * prevista, y un trasplante nunca antes de la siembra. Auditoría antes/después
 * de lo que cambió; sin cambios no escribe; `version` distinta → 409.
 */
export async function updateGardenCropRecord(
  actor: GardenActor,
  recordId: string,
  input: UpdateCropRecordInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireCropWriter(actor);
  const today = todayOf(now);
  const result = await prisma.$transaction(async (tx) => {
    const { record, batch } = await lockRecord(tx, recordId);
    if (record.voidedAt) throw new GardenCropRecordVoidedError();
    if (batch.archivedAt) throw new GardenBatchArchivedError();
    const sowing = record.type === 'SOWING';
    if (!sowing && input.method !== undefined) {
      throw new ValidationError('La modalidad es solo de la siembra.');
    }
    if (!sowing && input.quantityUnit) {
      throw new ValidationError('Los trasplantes se cuentan en plantines.');
    }

    const current = {
      performedOn: dateText(record.performedOn),
      performedByParticipantId: record.performedByParticipantId,
      method: record.method,
      location: record.location,
      quantity: record.quantity?.toString() ?? null,
      quantityUnit: record.quantityUnit,
      notes: record.notes,
    };
    const quantityNext = input.quantity !== undefined ? input.quantity : current.quantity;
    const unitNext = sowing
      ? input.quantityUnit !== undefined
        ? input.quantityUnit
        : current.quantityUnit
      : quantityNext
        ? 'SEEDLINGS'
        : null;
    const next = {
      performedOn: input.performedOn ?? current.performedOn,
      performedByParticipantId: (
        input.performedByParticipantId ?? current.performedByParticipantId
      ).toLowerCase(),
      method: sowing ? (input.method ?? current.method) : null,
      location: input.location ?? current.location,
      quantity: quantityNext,
      quantityUnit: unitNext,
      notes: input.notes !== undefined ? input.notes : current.notes,
    };
    const changedKeys = (Object.keys(next) as (keyof typeof next)[]).filter((key) =>
      key === 'quantity'
        ? !sameQuantity(current.quantity, next.quantity)
        : key === 'performedByParticipantId'
          ? current.performedByParticipantId.toLowerCase() !== next.performedByParticipantId
          : current[key] !== next[key],
    );
    if (changedKeys.length === 0) return { changed: false, batchId: record.batchId };
    if (input.version !== record.version) throw new GardenCropRecordChangedError();

    if (sowing && (next.quantity === null) !== (next.quantityUnit === null)) {
      throw new ValidationError('Indicá la cantidad junto con su unidad (semillas o gramos).');
    }
    assertWholeIfCounted(next.quantity, next.quantityUnit);
    if (changedKeys.includes('performedOn')) {
      assertNotFuture(next.performedOn, today);
      if (sowing) {
        const earliest = batch.transplantDates[0];
        if (earliest && next.performedOn > earliest) {
          throw new ValidationError(
            `La siembra no puede quedar después de un trasplante (${display(earliest)}).`,
          );
        }
        if (batch.transplantPending && batch.expected && next.performedOn > batch.expected) {
          throw new ValidationError(
            `La siembra no puede quedar después de la fecha prevista de trasplante (${display(batch.expected)}). Cambiá primero esa fecha.`,
          );
        }
      } else {
        assertNotBeforeSowing(next.performedOn, batch.sowingDate!, 'El trasplante');
      }
    }
    if (changedKeys.includes('performedByParticipantId')) {
      await requireActivePerformer(tx, next.performedByParticipantId);
    }

    await tx.kitchenGardenCropRecord.update({
      where: { id: recordId },
      data: {
        ...(changedKeys.includes('performedOn') ? { performedOn: toDbDate(next.performedOn) } : {}),
        ...(changedKeys.includes('performedByParticipantId')
          ? { performedByParticipantId: next.performedByParticipantId }
          : {}),
        ...(changedKeys.includes('method') ? { method: next.method } : {}),
        ...(changedKeys.includes('location') ? { location: next.location } : {}),
        ...(changedKeys.includes('quantity') || changedKeys.includes('quantityUnit')
          ? {
              quantity: next.quantity ? new Prisma.Decimal(next.quantity) : null,
              quantityUnit: next.quantityUnit,
            }
          : {}),
        ...(changedKeys.includes('notes') ? { notes: next.notes } : {}),
        version: { increment: 1 },
      },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.crop_record_corrected',
      entityType: 'KitchenGardenCropRecord',
      entityId: recordId,
      previousState: Object.fromEntries(changedKeys.map((key) => [key, current[key]])),
      newState: Object.fromEntries(changedKeys.map((key) => [key, next[key]])),
      ...meta,
    });
    return { changed: true, batchId: record.batchId };
  });
  return {
    batch: await loadBatchDetail(prisma, result.batchId, today),
    changed: result.changed,
  };
}

/** `12` y `12.00` son la misma cantidad. */
function sameQuantity(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Prisma.Decimal(a).equals(new Prisma.Decimal(b));
}

/**
 * Anular una siembra o un trasplante (ADMIN o participante activo, con
 * motivo): anulación lógica, nunca borrado. La siembra no se anula mientras
 * la tanda tenga trasplantes vigentes. Condicionada a `voided_at` nulo: un
 * doble clic o dos personas a la vez dan una sola anulación y una sola
 * auditoría (la otra, 409).
 */
export async function voidGardenCropRecord(
  actor: GardenActor,
  recordId: string,
  reason: string,
  meta: RequestMeta,
  now = new Date(),
) {
  requireCropWriter(actor);
  return prisma.$transaction(async (tx) => {
    const { record, batch } = await lockRecord(tx, recordId);
    if (record.voidedAt) throw new GardenCropRecordVoidedError();
    if (batch.archivedAt) throw new GardenBatchArchivedError();
    if (record.type === 'SOWING' && batch.transplantDates.length > 0) {
      throw new GardenSowingHasTransplantsError(batch.transplantDates.length);
    }
    const { count } = await tx.kitchenGardenCropRecord.updateMany({
      where: { id: recordId, voidedAt: null },
      data: { voidedAt: now, voidedByUserId: actor.userId, voidReason: reason },
    });
    if (count === 0) throw new GardenCropRecordVoidedError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'kitchen_garden.crop_record_voided',
      entityType: 'KitchenGardenCropRecord',
      entityId: recordId,
      previousState: {
        batchId: record.batchId,
        type: record.type,
        performedOn: dateText(record.performedOn),
        performedByParticipantId: record.performedByParticipantId,
        location: record.location,
        voided: false,
      },
      newState: { voided: true, reason },
      ...meta,
    });
    return {
      record: { id: recordId, batchId: record.batchId, voidedAt: now.toISOString() },
    };
  });
}
