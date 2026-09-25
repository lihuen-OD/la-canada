import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  ChickenCoopAlreadyConfiguredError,
  ChickenCoopCountChangedError,
  ChickenCoopCountLimitError,
  ChickenCoopNotConfiguredError,
  EggCollectionAlreadyVoidedError,
  EggCollectionNotFoundError,
  EggCollectorInvalidError,
  EmployeeLinkRequiredError,
  ForbiddenError,
  ValidationError,
} from '../errors/AppError';
import {
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import { resolveActor, type RequestMeta, type TaskActor } from '../tasks/tasksService';
import { computeCoopMetrics, layingRate, periodStart } from './chickenCoopMetrics';
import {
  MAX_ACTIVE_HENS,
  type ChickenCoopPeriodDays,
  type adjustChickenCoopHensBodySchema,
  type createEggCollectionBodySchema,
} from './chickenCoopSchemas';

/**
 * 🐔 Gallinero (Etapa 5G) — docs/BUSINESS_RULES.md §9. Permisos (paridad con
 * el prototipo, decididos acá con el rol leído de la base):
 *  - ver KPIs, análisis e historial, y registrar recolecciones: todo
 *    usuario autenticado;
 *  - configurar la cantidad inicial, "+ Alta"/"− Baja" y eliminar
 *    (anular) una recolección: solo ADMIN.
 *
 * El gallinero es el singleton `ChickenCoop.code = "main"`, siempre por
 * `findUnique` (nunca "la primera fila", la causa del bug del prototipo).
 * Nada se borra físicamente: eliminar una recolección la anula y deja
 * auditoría. Fechas y cálculos, solo en `BUSINESS_TIME_ZONE`.
 */

export type ChickenCoopActor = TaskActor;
export type { RequestMeta };
export { resolveActor };

export const MAIN_COOP_CODE = 'main';
const CREATE_COLLECTION_ENDPOINT = 'POST /chicken-coop/collections';

type CreateCollectionInput = z.infer<typeof createEggCollectionBodySchema>;
type AdjustHensInput = z.infer<typeof adjustChickenCoopHensBodySchema>;

function requireAdmin(actor: ChickenCoopActor, message?: string): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError(message);
}

const coopSelect = { id: true, activeHensCount: true, updatedAt: true } as const;
type CoopRow = Prisma.ChickenCoopGetPayload<{ select: typeof coopSelect }>;

const collectionSelect = {
  id: true,
  collectionDate: true,
  goodEggsCount: true,
  brokenEggsCount: true,
  notes: true,
  createdAt: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;
type CollectionRow = Prisma.EggCollectionGetPayload<{ select: typeof collectionSelect }>;

/** `@db.Date`: Prisma devuelve medianoche UTC = la fecha de calendario. */
const dateText = (value: Date): string => value.toISOString().slice(0, 10);
const toDbDate = (date: LocalDate): Date => new Date(Date.UTC(date.year, date.month - 1, date.day));

function serializeCoop(row: CoopRow | null) {
  return {
    configured: row !== null,
    activeHensCount: row?.activeHensCount ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

function serializeCollection(row: CollectionRow) {
  return {
    id: row.id,
    collectionDate: dateText(row.collectionDate),
    goodEggsCount: row.goodEggsCount,
    brokenEggsCount: row.brokenEggsCount,
    notes: row.notes,
    employee: row.employee,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SerializedEggCollection = ReturnType<typeof serializeCollection>;

function findMainCoop(client: Prisma.TransactionClient | typeof prisma) {
  return client.chickenCoop.findUnique({ where: { code: MAIN_COOP_CODE }, select: coopSelect });
}

// ── Consulta ──────────────────────────────────────────────────────────────

/**
 * KPIs + análisis del período en DOS sentencias en paralelo: el singleton y
 * un `GROUP BY collection_date` de las recolecciones vigentes del período
 * (índice `egg_collections_collection_date_idx`). Nunca carga filas sueltas.
 */
export async function getChickenCoopSummary(
  _actor: ChickenCoopActor,
  filters: { days: ChickenCoopPeriodDays },
  now = new Date(),
) {
  const today = toLocalDate(now, config.businessTimeZone);
  const from = periodStart(today, filters.days);
  const [coop, grouped] = await Promise.all([
    findMainCoop(prisma),
    prisma.eggCollection.groupBy({
      by: ['collectionDate'],
      where: { voidedAt: null, collectionDate: { gte: toDbDate(from), lte: toDbDate(today) } },
      _sum: { goodEggsCount: true, brokenEggsCount: true },
      orderBy: { collectionDate: 'asc' },
    }),
  ]);
  const metrics = computeCoopMetrics({
    today,
    days: filters.days,
    hens: coop?.activeHensCount ?? null,
    totals: grouped.map((row) => ({
      date: dateText(row.collectionDate),
      goodEggs: row._sum.goodEggsCount ?? 0,
      brokenEggs: row._sum.brokenEggsCount ?? 0,
    })),
  });
  return { timeZone: config.businessTimeZone, coop: serializeCoop(coop), ...metrics };
}

/**
 * Historial agrupado por fecha (más reciente primero), paginado por DÍAS:
 * una página trae días completos con sus totales, la postura de cada día y
 * sus recolecciones. Cuatro sentencias fijas (sin N+1): singleton, página de
 * fechas (`GROUP BY` + `LIMIT/OFFSET`), cantidad de fechas y las
 * recolecciones de esas fechas con su persona (JOIN).
 */
export async function listEggCollectionHistory(
  _actor: ChickenCoopActor,
  filters: { page: number; pageSize: number },
) {
  const [coop, dayRows, countRows] = await Promise.all([
    findMainCoop(prisma),
    prisma.eggCollection.groupBy({
      by: ['collectionDate'],
      where: { voidedAt: null },
      _sum: { goodEggsCount: true, brokenEggsCount: true },
      orderBy: { collectionDate: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT COUNT(DISTINCT "collection_date") AS "total" FROM "egg_collections" WHERE "voided_at" IS NULL`,
    ),
  ]);
  const totalDays = Number(countRows[0]?.total ?? 0);
  const collections =
    dayRows.length === 0
      ? []
      : await prisma.eggCollection.findMany({
          where: {
            voidedAt: null,
            collectionDate: { in: dayRows.map((row) => row.collectionDate) },
          },
          select: collectionSelect,
          orderBy: [{ collectionDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });
  const hens = coop?.activeHensCount ?? null;
  const days = dayRows.map((row) => {
    const date = dateText(row.collectionDate);
    const goodEggs = row._sum.goodEggsCount ?? 0;
    return {
      date,
      goodEggs,
      brokenEggs: row._sum.brokenEggsCount ?? 0,
      layingRate: layingRate(goodEggs, hens),
      collections: collections
        .filter((collection) => dateText(collection.collectionDate) === date)
        .map(serializeCollection),
    };
  });
  return {
    coop: serializeCoop(coop),
    days,
    page: filters.page,
    pageSize: filters.pageSize,
    totalDays,
    totalPages: Math.max(1, Math.ceil(totalDays / filters.pageSize)),
  };
}

// ── Recolecciones ─────────────────────────────────────────────────────────

function resolveCollectionDate(text: string | undefined, now: Date): LocalDate {
  const today = toLocalDate(now, config.businessTimeZone);
  const local = text === undefined ? today : parseLocalDate(text);
  if (!local) throw new ValidationError('La fecha no es válida.');
  if (compareLocalDates(local, today) > 0) {
    throw new ValidationError('La fecha de la recolección no puede ser futura.');
  }
  return local;
}

/**
 * "¿Quién juntó?": EMPLOYEE queda fijado a su empleado (otro id → 403);
 * ADMIN elige un empleado activo (validado en la transacción) o, sin
 * elegir, su propio empleado si lo tiene. Un ADMIN sin empleado vinculado
 * debe elegir: el prototipo siempre asociaba una persona.
 */
function resolveCollector(
  actor: ChickenCoopActor,
  requested: string | undefined,
): { employeeId: string; chosenByAdmin: boolean } {
  if (actor.role !== 'ADMIN') {
    if (!actor.employeeId) throw new EmployeeLinkRequiredError();
    if (requested !== undefined && requested.toLowerCase() !== actor.employeeId.toLowerCase()) {
      throw new ForbiddenError(
        'Solo un administrador puede registrar una recolección a nombre de otra persona.',
      );
    }
    return { employeeId: actor.employeeId, chosenByAdmin: false };
  }
  if (requested !== undefined) {
    return { employeeId: requested.toLowerCase(), chosenByAdmin: true };
  }
  if (!actor.employeeId) throw new ValidationError('Elegí quién juntó los huevos.');
  return { employeeId: actor.employeeId, chosenByAdmin: false };
}

export type CreateEggCollectionResult =
  | { kind: 'created'; body: { collection: SerializedEggCollection } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

export async function createEggCollection(
  actor: ChickenCoopActor,
  input: CreateCollectionInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
): Promise<CreateEggCollectionResult> {
  const { employeeId, chosenByAdmin } = resolveCollector(actor, input.employeeId);
  const date = resolveCollectionDate(input.collectionDate, now);
  const collectionDate = formatLocalDate(date);

  const write = async (tx: Prisma.TransactionClient) => {
    // Secuencial a propósito: una transacción interactiva usa UNA conexión.
    if (chosenByAdmin) {
      const employee = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { active: true },
      });
      if (!employee?.active) throw new EggCollectorInvalidError();
    }
    const coop = await findMainCoop(tx);
    const row = await tx.eggCollection.create({
      data: {
        chickenCoopId: coop?.id ?? null,
        collectionDate: toDbDate(date),
        goodEggsCount: input.goodEggsCount,
        brokenEggsCount: input.brokenEggsCount,
        employeeId,
        notes: input.notes ?? null,
        recordedByUserId: actor.userId,
      },
      select: collectionSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'chicken_coop.collection_created',
      entityType: 'EggCollection',
      entityId: row.id,
      newState: {
        collectionDate,
        goodEggsCount: row.goodEggsCount,
        brokenEggsCount: row.brokenEggsCount,
        employeeId,
        hasNotes: row.notes !== null,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { collection: serializeCollection(row) };
  };

  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  // Huella con la fecha y la persona YA resueltas: la misma clave reusada
  // otro día (o con otra persona) es un conflicto, nunca un replay.
  const requestHash = canonicalRequestHash([
    CREATE_COLLECTION_ENDPOINT,
    collectionDate,
    input.goodEggsCount,
    input.brokenEggsCount,
    employeeId,
    input.notes ?? null,
  ]);
  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint: CREATE_COLLECTION_ENDPOINT,
    key: idempotencyKey,
    requestHash,
    status: 201,
    run: write,
  });
}

/**
 * "✕" del historial (solo ADMIN, confirmación en el cliente). Anulación
 * lógica con `updateMany` condicionado a `voidedAt: null`: dos anulaciones
 * simultáneas nunca se aplican ambas, y la fila + su auditoría se conservan.
 */
export async function voidEggCollection(
  actor: ChickenCoopActor,
  collectionId: string,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede eliminar recolecciones.');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.eggCollection.findUnique({
      where: { id: collectionId },
      select: { ...collectionSelect, voidedAt: true },
    });
    if (!existing) throw new EggCollectionNotFoundError();
    const { count } = await tx.eggCollection.updateMany({
      where: { id: collectionId, voidedAt: null },
      data: { voidedAt: now, voidedByUserId: actor.userId },
    });
    if (count === 0) throw new EggCollectionAlreadyVoidedError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'chicken_coop.collection_voided',
      entityType: 'EggCollection',
      entityId: collectionId,
      previousState: {
        collectionDate: dateText(existing.collectionDate),
        goodEggsCount: existing.goodEggsCount,
        brokenEggsCount: existing.brokenEggsCount,
        employeeId: existing.employee?.id ?? null,
        voided: false,
      },
      newState: { voided: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { collection: { id: collectionId, voidedAt: now.toISOString() } };
  });
}

// ── Gallinas activas (solo ADMIN) ─────────────────────────────────────────

function isCoopCodeConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Configuración inicial real: crea el singleton con la cantidad que informa
 * el ADMIN (nunca se inventa ni se siembra). Solo una vez; el unique de
 * `code` resuelve dos configuraciones simultáneas (la segunda → 409).
 */
export async function configureChickenCoop(
  actor: ChickenCoopActor,
  input: { activeHensCount: number },
  meta: RequestMeta,
) {
  requireAdmin(actor, 'Solo un administrador puede configurar el gallinero.');
  try {
    const coop = await prisma.$transaction(async (tx) => {
      const row = await tx.chickenCoop.create({
        data: { code: MAIN_COOP_CODE, activeHensCount: input.activeHensCount },
        select: coopSelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'chicken_coop.configured',
        entityType: 'ChickenCoop',
        entityId: row.id,
        newState: { code: MAIN_COOP_CODE, activeHensCount: row.activeHensCount },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return row;
    });
    return { coop: serializeCoop(coop) };
  } catch (error) {
    if (isCoopCodeConflict(error)) throw new ChickenCoopAlreadyConfiguredError();
    throw error;
  }
}

/**
 * "+ Alta" / "− Baja" de a una gallina. Actualización condicional atómica
 * sobre la cantidad que el ADMIN confirmó: si otro cambio llegó antes, no se
 * aplica nada (409) — nunca un valor distinto del confirmado, nunca negativo.
 */
export async function adjustChickenCoopHens(
  actor: ChickenCoopActor,
  input: AdjustHensInput,
  meta: RequestMeta,
) {
  requireAdmin(actor, 'Solo un administrador puede dar de alta o de baja gallinas.');
  const next = input.expectedCount + input.delta;
  if (next < 0) throw new ChickenCoopCountLimitError();
  if (next > MAX_ACTIVE_HENS) {
    throw new ChickenCoopCountLimitError(
      `La cantidad de gallinas no puede superar ${MAX_ACTIVE_HENS.toLocaleString('es-AR')}.`,
    );
  }
  const coop = await prisma.$transaction(async (tx) => {
    const { count } = await tx.chickenCoop.updateMany({
      where: { code: MAIN_COOP_CODE, activeHensCount: input.expectedCount },
      data: { activeHensCount: next },
    });
    if (count === 0) {
      const current = await findMainCoop(tx);
      if (!current) throw new ChickenCoopNotConfiguredError();
      throw new ChickenCoopCountChangedError();
    }
    const row = await findMainCoop(tx);
    if (!row) throw new ChickenCoopNotConfiguredError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'chicken_coop.hens_adjusted',
      entityType: 'ChickenCoop',
      entityId: row.id,
      previousState: { activeHensCount: input.expectedCount },
      newState: { activeHensCount: next, delta: input.delta },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return row;
  });
  return { coop: serializeCoop(coop) };
}
