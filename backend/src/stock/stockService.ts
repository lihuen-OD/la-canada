import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  DuplicateStockCategoryError,
  DuplicateStockItemError,
  EmployeeLinkRequiredError,
  ForbiddenError,
  IdempotencyKeyConflictError,
  IdempotencyKeyInvalidError,
  IdempotencyRecordPendingError,
  StockBalanceLimitError,
  StockCategoryInUseError,
  StockCategoryInactiveError,
  StockCategoryNotFoundError,
  StockDestinationDuplicateError,
  StockDestinationInactiveError,
  StockDestinationNotFoundError,
  StockInsufficientQuantityError,
  StockItemInactiveError,
  StockItemNotFoundError,
  ValidationError,
} from '../errors/AppError';
import {
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  toLocalDate,
} from '../lib/businessTime';
import { prisma } from '../lib/prisma';
import { resolveActor, type RequestMeta, type TaskActor } from '../tasks/tasksService';
import { buildStockLevelIdsSql, computeStockLevel, type StockLevel } from './stockLevel';
import {
  IDEMPOTENCY_KEY_PATTERN,
  type createStockMovementBodySchema,
  type listStockMovementsQuerySchema,
} from './stockSchemas';
import type { z } from 'zod';

/**
 * Reglas del módulo Stock (Etapa 5A) — ver docs/BUSINESS_RULES.md §7-§8 y
 * docs/DATABASE.md "Estrategia de inventario". Todo permiso se decide acá con
 * el rol y el empleado leídos de la base; el frontend solo oculta lo que igual
 * se rechazaría.
 *
 * Inventario: `StockItem.currentQuantity` es un saldo desnormalizado que solo
 * cambia dentro de una transacción que también crea su `StockMovement` (nunca
 * se edita cantidades "a mano" desde el producto). Un consumo/ajuste a la baja
 * usa una actualización condicional atómica (`currentQuantity >= cantidad`)
 * — nunca leer-calcular-escribir sin condición — para que dos movimientos
 * simultáneos no puedan dejar el saldo en negativo.
 */

export type StockActor = TaskActor;
export type { RequestMeta };
export { resolveActor };

const MAX_STOCK_DECIMAL = new Prisma.Decimal('99999999.99');

type CreateMovementInput = z.infer<typeof createStockMovementBodySchema>;
type ListMovementsFilters = z.infer<typeof listStockMovementsQuerySchema>;

function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Prisma 7 con driver adapter informa la restricción dentro de
 * `meta.driverAdapterError.cause.constraint`; otros engines/versiones usan
 * `meta.target`. Se aceptan ambas formas, pero nunca un P2002 sin identidad:
 * un unique ajeno no puede convertirse por accidente en replay o duplicado.
 */
function isUniqueViolationOn(
  error: unknown,
  expectedFields: readonly string[],
  expectedIndex: string,
): boolean {
  if (!isUniqueViolation(error)) return false;
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { fields?: unknown; index?: unknown } };
        };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const target = meta?.target ?? constraint?.fields;
  if (Array.isArray(target)) {
    return (
      target.length === expectedFields.length &&
      expectedFields.every((field) => target.includes(field))
    );
  }
  return target === expectedIndex || constraint?.index === expectedIndex;
}

function isTransactionTimeout(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
}

const CATEGORY_UNIQUE_FIELDS = ['name', 'area'] as const;
const CATEGORY_UNIQUE_INDEX = 'stock_categories_name_area_key';
const ITEM_UNIQUE_FIELDS = ['area', 'name'] as const;
const ITEM_UNIQUE_INDEX = 'stock_items_area_name_key';
const DESTINATION_UNIQUE_FIELDS = ['name'] as const;
const DESTINATION_UNIQUE_INDEX = 'consumption_destinations_name_key';
const IDEMPOTENCY_UNIQUE_FIELDS = ['actor_user_id', 'endpoint', 'key'] as const;
const IDEMPOTENCY_UNIQUE_INDEX = 'idempotency_records_actor_user_id_endpoint_key_key';
const IDEMPOTENCY_TRANSACTION_TIMEOUT_MS = 15_000;

function requireAdmin(actor: StockActor): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError();
}

const employeeSummarySelect = { id: true, displayName: true, colorHex: true } as const;

const categorySelect = { id: true, name: true, area: true, active: true } as const;

const destinationSelect = { id: true, name: true, type: true, active: true } as const;

const itemSelect = {
  id: true,
  name: true,
  area: true,
  unit: true,
  minimumQuantity: true,
  currentQuantity: true,
  active: true,
  category: { select: { id: true, name: true, area: true } },
} as const;

type ItemRow = Prisma.StockItemGetPayload<{ select: typeof itemSelect }>;

const movementSelect = {
  id: true,
  type: true,
  quantity: true,
  effectiveDate: true,
  reason: true,
  createdAt: true,
  employee: { select: employeeSummarySelect },
  destination: { select: { id: true, name: true, type: true } },
} as const;

type MovementRow = Prisma.StockMovementGetPayload<{ select: typeof movementSelect }>;

// ── Serialización ─────────────────────────────────────────────────────────

function serializeItem(row: ItemRow) {
  return {
    id: row.id,
    name: row.name,
    area: row.area,
    unit: row.unit,
    minimumQuantity: row.minimumQuantity.toString(),
    currentQuantity: row.currentQuantity.toString(),
    // Nivel calculado por el backend (Etapa 5C.1): el frontend solo lo
    // renderiza; el `barPercent` de la barra sigue siendo calculado allá.
    stockLevel: computeStockLevel(row.currentQuantity, row.minimumQuantity),
    active: row.active,
    category: row.category,
  };
}

export type SerializedStockItem = ReturnType<typeof serializeItem>;

function serializeMovement(row: MovementRow) {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity.toString(),
    // `@db.Date`: Prisma devuelve medianoche UTC = la fecha de calendario.
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    reason: row.reason,
    employee: row.employee,
    destination: row.destination,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SerializedStockMovement = ReturnType<typeof serializeMovement>;

// ── Consulta ──────────────────────────────────────────────────────────────

export async function listStockCategories(
  actor: StockActor,
  filters: { status: 'active' | 'all' },
) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver categorías inactivas.');
  }
  const categories = await prisma.stockCategory.findMany({
    where: filters.status === 'active' ? { active: true } : {},
    select: categorySelect,
    // Orden enum de Postgres (HOUSE, GARDEN, BOTH) — Casa primero, como el prototipo.
    orderBy: [{ area: 'asc' }, { name: 'asc' }],
  });
  return { categories };
}

export interface ListStockItemsFilters {
  area?: 'HOUSE' | 'GARDEN';
  categoryId?: string;
  status: 'active' | 'inactive' | 'all';
  q?: string;
  stockLevel?: StockLevel;
  page: number;
  pageSize: number;
}

export async function listStockItems(actor: StockActor, filters: ListStockItemsFilters) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver productos inactivos.');
  }
  const where: Prisma.StockItemWhereInput = {
    ...(filters.status === 'active' ? { active: true } : {}),
    ...(filters.status === 'inactive' ? { active: false } : {}),
    ...(filters.area ? { area: filters.area } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.q ? { name: { contains: filters.q, mode: 'insensitive' } } : {}),
  };
  if (filters.stockLevel) {
    // Comparación columna-vs-columna (`current < minimum`): Prisma no la
    // expresa en `where`, así que Postgres resuelve los ids del nivel con el
    // SQL parametrizado de stock/stockLevel.ts; conteo, orden y paginación
    // siguen yendo a Postgres con el resto de los filtros. Nunca se carga el
    // inventario completo para filtrar en memoria.
    const levelRows = await prisma.$queryRaw<{ id: string }[]>(
      buildStockLevelIdsSql(filters.stockLevel),
    );
    if (levelRows.length === 0) {
      return {
        items: [],
        page: filters.page,
        pageSize: filters.pageSize,
        total: 0,
        totalPages: 1,
      };
    }
    where.id = { in: levelRows.map((row) => row.id) };
  }
  const skip = (filters.page - 1) * filters.pageSize;
  const [total, rows] = await Promise.all([
    prisma.stockItem.count({ where }),
    prisma.stockItem.findMany({
      where,
      select: itemSelect,
      orderBy: [{ area: 'asc' }, { name: 'asc' }],
      skip,
      take: filters.pageSize,
    }),
  ]);
  return {
    items: rows.map(serializeItem),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

export async function getStockItem(itemId: string) {
  const row = await prisma.stockItem.findUnique({ where: { id: itemId }, select: itemSelect });
  if (!row) throw new StockItemNotFoundError();
  return { item: serializeItem(row) };
}

/**
 * Solo activos por defecto (el catálogo de la operación); `status=all` es de
 * ADMIN — mismo patrón que categorías.
 */
export async function listStockDestinations(
  actor: StockActor,
  filters: { status: 'active' | 'all' },
) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver destinos inactivos.');
  }
  const destinations = await prisma.consumptionDestination.findMany({
    where: filters.status === 'active' ? { active: true } : {},
    select: destinationSelect,
    orderBy: { name: 'asc' },
  });
  return { destinations };
}

export async function listStockMovements(itemId: string, filters: ListMovementsFilters) {
  const item = await prisma.stockItem.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!item) throw new StockItemNotFoundError();
  const where = {
    stockItemId: itemId,
    ...(filters.type ? { type: filters.type } : {}),
  };
  const skip = (filters.page - 1) * filters.pageSize;
  const [total, rows] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      select: movementSelect,
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: filters.pageSize,
    }),
  ]);
  return {
    movements: rows.map(serializeMovement),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

// ── Administración del catálogo ───────────────────────────────────────────

export interface CreateStockCategoryInput {
  name: string;
  area: 'HOUSE' | 'GARDEN' | 'BOTH';
}

export async function createStockCategory(
  actor: StockActor,
  input: CreateStockCategoryInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    const category = await prisma.$transaction(async (tx) => {
      const created = await tx.stockCategory.create({
        data: input,
        select: categorySelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'stock.category.created',
        entityType: 'StockCategory',
        entityId: created.id,
        newState: { ...input, active: true },
        ...meta,
      });
      return created;
    });
    return { category };
  } catch (error) {
    if (isUniqueViolationOn(error, CATEGORY_UNIQUE_FIELDS, CATEGORY_UNIQUE_INDEX)) {
      throw new DuplicateStockCategoryError();
    }
    throw error;
  }
}

export interface UpdateStockCategoryInput {
  name?: string;
  active?: boolean;
}

export async function updateStockCategory(
  actor: StockActor,
  categoryId: string,
  input: UpdateStockCategoryInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.stockCategory.findUnique({
        where: { id: categoryId },
        select: { name: true, active: true },
      });
      if (!current) throw new StockCategoryNotFoundError();

      const changes: UpdateStockCategoryInput = {};
      const previous: UpdateStockCategoryInput = {};
      for (const key of ['name', 'active'] as const) {
        const next = input[key];
        if (next !== undefined && next !== current[key]) {
          (changes as Record<string, unknown>)[key] = next;
          (previous as Record<string, unknown>)[key] = current[key];
        }
      }
      if (Object.keys(changes).length === 0) return;

      if (changes.active === false) {
        const activeItems = await tx.stockItem.count({
          where: { categoryId, active: true },
        });
        if (activeItems > 0) throw new StockCategoryInUseError();
      }

      await tx.stockCategory.update({ where: { id: categoryId }, data: changes });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'stock.category.updated',
        entityType: 'StockCategory',
        entityId: categoryId,
        previousState: { ...previous },
        newState: { ...changes },
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolationOn(error, CATEGORY_UNIQUE_FIELDS, CATEGORY_UNIQUE_INDEX)) {
      throw new DuplicateStockCategoryError();
    }
    throw error;
  }
  const row = await prisma.stockCategory.findUnique({
    where: { id: categoryId },
    select: categorySelect,
  });
  if (!row) throw new StockCategoryNotFoundError();
  return { category: row };
}

export interface CreateStockItemInput {
  name: string;
  area: 'HOUSE' | 'GARDEN';
  categoryId: string;
  unit: string;
  minimumQuantity: string;
}

async function requireAssignableCategory(
  client: Prisma.TransactionClient,
  categoryId: string,
  area: 'HOUSE' | 'GARDEN' | 'BOTH',
) {
  const category = await client.stockCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, area: true, active: true },
  });
  if (!category) throw new StockCategoryNotFoundError();
  if (!category.active) throw new StockCategoryInactiveError();
  if (category.area !== area && category.area !== 'BOTH') {
    throw new ValidationError('La categoría no corresponde al área indicada.');
  }
  return category;
}

/**
 * Crea el producto con saldo 0 — sin movimiento: `OPENING_BALANCE` es
 * exclusivo del seed (ver enum). La carga inicial de stock se hace con un
 * `INCOME` desde `createStockMovement`, que sí deja su trazabilidad.
 */
export async function createStockItem(
  actor: StockActor,
  input: CreateStockItemInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    const item = await prisma.$transaction(async (tx) => {
      await requireAssignableCategory(tx, input.categoryId, input.area);
      const created = await tx.stockItem.create({
        data: {
          name: input.name,
          area: input.area,
          categoryId: input.categoryId,
          unit: input.unit,
          minimumQuantity: new Prisma.Decimal(input.minimumQuantity),
          currentQuantity: new Prisma.Decimal(0),
        },
        select: itemSelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'stock.item.created',
        entityType: 'StockItem',
        entityId: created.id,
        newState: {
          name: input.name,
          area: input.area,
          categoryId: input.categoryId,
          unit: input.unit,
          minimumQuantity: input.minimumQuantity,
          currentQuantity: '0',
          active: true,
        },
        ...meta,
      });
      return created;
    });
    return { item: serializeItem(item) };
  } catch (error) {
    if (isUniqueViolationOn(error, ITEM_UNIQUE_FIELDS, ITEM_UNIQUE_INDEX)) {
      throw new DuplicateStockItemError();
    }
    throw error;
  }
}

export interface UpdateStockItemInput {
  name?: string;
  categoryId?: string;
  unit?: string;
  minimumQuantity?: string;
}

/**
 * Nunca modifica `currentQuantity` (ni siquiera llega: el schema es
 * `.strict()` y no lo declara) ni `area`. Toda variación de existencia pasa
 * por un `StockMovement`.
 */
export async function updateStockItem(
  actor: StockActor,
  itemId: string,
  input: UpdateStockItemInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.stockItem.findUnique({
        where: { id: itemId },
        select: { name: true, area: true, categoryId: true, unit: true, minimumQuantity: true },
      });
      if (!current) throw new StockItemNotFoundError();

      const changes: {
        name?: string;
        categoryId?: string;
        unit?: string;
        minimumQuantity?: Prisma.Decimal;
      } = {};
      const auditChanges: Record<string, string> = {};
      const auditPrevious: Record<string, string> = {};
      if (input.name !== undefined && input.name !== current.name) {
        changes.name = input.name;
        auditChanges.name = input.name;
        auditPrevious.name = current.name;
      }
      if (input.unit !== undefined && input.unit !== current.unit) {
        changes.unit = input.unit;
        auditChanges.unit = input.unit;
        auditPrevious.unit = current.unit;
      }
      if (
        input.minimumQuantity !== undefined &&
        !new Prisma.Decimal(input.minimumQuantity).equals(current.minimumQuantity)
      ) {
        changes.minimumQuantity = new Prisma.Decimal(input.minimumQuantity);
        auditChanges.minimumQuantity = input.minimumQuantity;
        auditPrevious.minimumQuantity = current.minimumQuantity.toString();
      }
      if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
        const category = await requireAssignableCategory(tx, input.categoryId, current.area);
        changes.categoryId = category.id;
        auditChanges.categoryId = input.categoryId;
        auditPrevious.categoryId = current.categoryId;
      }
      if (Object.keys(changes).length === 0) return;

      await tx.stockItem.update({ where: { id: itemId }, data: changes });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'stock.item.updated',
        entityType: 'StockItem',
        entityId: itemId,
        previousState: auditPrevious,
        newState: auditChanges,
        ...meta,
      });
    });
  } catch (error) {
    if (isUniqueViolationOn(error, ITEM_UNIQUE_FIELDS, ITEM_UNIQUE_INDEX)) {
      throw new DuplicateStockItemError();
    }
    throw error;
  }
  const row = await prisma.stockItem.findUnique({ where: { id: itemId }, select: itemSelect });
  if (!row) throw new StockItemNotFoundError();
  return { item: serializeItem(row) };
}

/** Sin borrado físico: desactivar conserva el producto y todo su historial. */
export async function setStockItemActive(
  actor: StockActor,
  itemId: string,
  active: boolean,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  await prisma.$transaction(async (tx) => {
    const current = await tx.stockItem.findUnique({
      where: { id: itemId },
      select: { active: true },
    });
    if (!current) throw new StockItemNotFoundError();
    if (current.active === active) return;
    await tx.stockItem.update({ where: { id: itemId }, data: { active } });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: active ? 'stock.item.activated' : 'stock.item.deactivated',
      entityType: 'StockItem',
      entityId: itemId,
      previousState: { active: current.active },
      newState: { active },
      ...meta,
    });
  });
  const row = await prisma.stockItem.findUnique({ where: { id: itemId }, select: itemSelect });
  if (!row) throw new StockItemNotFoundError();
  return { item: serializeItem(row) };
}

// ── Destinos de consumo ───────────────────────────────────────────────────

export interface CreateStockDestinationInput {
  name: string;
  type: 'VEHICLE' | 'SECTOR';
}

/**
 * Alta de destino (Etapa 5C.1A): solo ADMIN. Nunca se borran destinos —
 * la baja es inactivación (`updateStockDestination`), porque los
 * `StockMovement` históricos conservan su referencia.
 */
export async function createStockDestination(
  actor: StockActor,
  input: CreateStockDestinationInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    const destination = await prisma.$transaction(async (tx) => {
      const created = await tx.consumptionDestination.create({
        data: input,
        select: destinationSelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'stock.destination.created',
        entityType: 'ConsumptionDestination',
        entityId: created.id,
        newState: { ...input, active: true },
        ...meta,
      });
      return created;
    });
    return { destination };
  } catch (error) {
    if (isUniqueViolationOn(error, DESTINATION_UNIQUE_FIELDS, DESTINATION_UNIQUE_INDEX)) {
      throw new StockDestinationDuplicateError();
    }
    throw error;
  }
}

export interface UpdateStockDestinationInput {
  name?: string;
  active?: boolean;
}

/**
 * Edición de destino (Etapa 5C.1A): solo ADMIN; `type` es inmutable.
 * Sin borrado físico — inactivar siempre está permitido, aunque el destino
 * tenga movimientos históricos (esos registros no se tocan). Un cambio de
 * nombre y uno de estado dejan dos auditorías separadas
 * (`stock.destination.updated` / `stock.destination.status_changed`).
 */
export async function updateStockDestination(
  actor: StockActor,
  destinationId: string,
  input: UpdateStockDestinationInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.consumptionDestination.findUnique({
        where: { id: destinationId },
        select: { name: true, active: true },
      });
      if (!current) throw new StockDestinationNotFoundError();

      if (input.name !== undefined && input.name !== current.name) {
        await tx.consumptionDestination.update({
          where: { id: destinationId },
          data: { name: input.name },
        });
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'stock.destination.updated',
          entityType: 'ConsumptionDestination',
          entityId: destinationId,
          previousState: { name: current.name },
          newState: { name: input.name },
          ...meta,
        });
      }
      if (input.active !== undefined && input.active !== current.active) {
        await tx.consumptionDestination.update({
          where: { id: destinationId },
          data: { active: input.active },
        });
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'stock.destination.status_changed',
          entityType: 'ConsumptionDestination',
          entityId: destinationId,
          previousState: { active: current.active },
          newState: { active: input.active },
          ...meta,
        });
      }
    });
  } catch (error) {
    if (isUniqueViolationOn(error, DESTINATION_UNIQUE_FIELDS, DESTINATION_UNIQUE_INDEX)) {
      throw new StockDestinationDuplicateError();
    }
    throw error;
  }
  const row = await prisma.consumptionDestination.findUnique({
    where: { id: destinationId },
    select: destinationSelect,
  });
  if (!row) throw new StockDestinationNotFoundError();
  return { destination: row };
}

// ── Movimientos ───────────────────────────────────────────────────────────

const DECREASING_TYPES = new Set(['CONSUMPTION', 'ADJUSTMENT_DECREASE']);
const ADMIN_ONLY_TYPES = new Set(['ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE']);

/**
 * Fecha de efecto: la del body si viene (validada como fecha real de
 * calendario), si no el día de hoy en la zona de negocio. Se guarda como
 * `@db.Date` (medianoche UTC de esa fecha local).
 */
function resolveEffectiveDate(
  text: string | undefined,
  now: Date,
  actor: StockActor,
): { date: Date; text: string } {
  const local = text ? parseLocalDate(text) : toLocalDate(now, config.businessTimeZone);
  if (!local) throw new ValidationError('La fecha no es válida.');
  const today = toLocalDate(now, config.businessTimeZone);
  if (compareLocalDates(local, today) > 0) {
    throw new ValidationError('La fecha efectiva no puede ser futura.');
  }
  if (actor.role !== 'ADMIN' && compareLocalDates(local, today) !== 0) {
    throw new ForbiddenError('Solo un administrador puede registrar movimientos retroactivos.');
  }
  return {
    date: new Date(Date.UTC(local.year, local.month - 1, local.day)),
    text: formatLocalDate(local),
  };
}

interface MovementWriteContext {
  actor: StockActor;
  itemId: string;
  input: CreateMovementInput;
  employeeId: string | null;
  quantity: Prisma.Decimal;
  effectiveDate: Date;
  effectiveDateText: string;
  decreasing: boolean;
  meta: RequestMeta;
}

/**
 * Escritura transaccional del movimiento: valida producto/destino, aplica la
 * actualización condicional del saldo, crea el `StockMovement` y registra la
 * auditoría — siempre juntos. Compartida por el camino sin clave y por el
 * idempotente; en ambos la transacción confirma o revierte completo.
 */
async function writeMovement(
  tx: Prisma.TransactionClient,
  ctx: MovementWriteContext,
): Promise<string> {
  const {
    actor,
    itemId,
    input,
    employeeId,
    quantity,
    effectiveDate,
    effectiveDateText,
    decreasing,
  } = ctx;
  const item = await tx.stockItem.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, unit: true, currentQuantity: true, active: true },
  });
  if (!item) throw new StockItemNotFoundError();
  if (!item.active) throw new StockItemInactiveError();

  if (input.destinationId) {
    const destination = await tx.consumptionDestination.findUnique({
      where: { id: input.destinationId },
      select: { id: true, active: true },
    });
    if (!destination) throw new StockDestinationNotFoundError();
    if (!destination.active) throw new StockDestinationInactiveError();
  }

  if (decreasing) {
    const current = new Prisma.Decimal(item.currentQuantity);
    if (current.lt(quantity)) {
      throw new StockInsufficientQuantityError(
        `La cantidad supera el stock actual (${current.toString()} ${item.unit}).`,
      );
    }
    // Actualización condicional atómica: Postgres re-verifica la
    // condición bajo el lock de fila, así que dos consumos simultáneos
    // no pueden dejar el saldo en negativo (nunca leer-calcular-escribir
    // sin condición).
    const updated = await tx.stockItem.updateMany({
      where: { id: itemId, active: true, currentQuantity: { gte: quantity } },
      data: { currentQuantity: { decrement: quantity } },
    });
    if (updated.count === 0) {
      throw new StockInsufficientQuantityError();
    }
  } else {
    const maximumPreviousBalance = MAX_STOCK_DECIMAL.sub(quantity);
    const updated = await tx.stockItem.updateMany({
      where: {
        id: itemId,
        active: true,
        currentQuantity: { lte: maximumPreviousBalance },
      },
      data: { currentQuantity: { increment: quantity } },
    });
    if (updated.count === 0) throw new StockBalanceLimitError();
  }

  const movement = await tx.stockMovement.create({
    data: {
      stockItemId: itemId,
      type: input.type,
      quantity,
      effectiveDate,
      employeeId,
      destinationId: input.destinationId ?? null,
      reason: input.reason ?? null,
      // `reference` es solo idempotencia del seed; la operación normal queda en null.
      reference: null,
    },
    select: { id: true },
  });
  await recordAuditLog(tx, {
    actorUserId: actor.userId,
    action: 'stock.movement.created',
    entityType: 'StockMovement',
    entityId: movement.id,
    newState: {
      stockItemId: itemId,
      type: input.type,
      quantity: input.quantity,
      effectiveDate: effectiveDateText,
      employeeId,
      destinationId: input.destinationId ?? null,
      reason: input.reason ?? null,
      actorRole: actor.role,
    },
    ...ctx.meta,
  });
  return movement.id;
}

/**
 * Huella del request para idempotencia (Etapa 5C.1): serialización canónica
 * con orden de propiedades fijo — endpoint lógico + itemId + body ya
 * validado y normalizado por Zod — y cantidades como `Decimal` a dos
 * decimales (nunca float de JavaScript). Los opcionales van como `null`
 * explícito y los UUID en minúsculas (Postgres los trata igual sin importar
 * mayúsculas). No incluye secretos ni valores aleatorios: dos reintentos del
 * mismo request producen el mismo hash; un body distinto, otro hash.
 */
export function computeMovementRequestHash(
  endpoint: string,
  itemId: string,
  input: CreateMovementInput,
  resolvedEffectiveDate: string,
): string {
  const canonical = JSON.stringify({
    endpoint,
    itemId: itemId.toLowerCase(),
    type: input.type,
    quantity: new Prisma.Decimal(input.quantity).toFixed(2),
    // Siempre la fecha efectiva ya resuelta en BUSINESS_TIME_ZONE. Si el
    // cliente omitió la fecha, reutilizar la clave otro día es conflicto,
    // no un replay silencioso del movimiento del día anterior.
    effectiveDate: resolvedEffectiveDate,
    destinationId: input.destinationId?.toLowerCase() ?? null,
    reason: input.reason ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export type CreateStockMovementResult =
  | { kind: 'created'; movement: SerializedStockMovement; item: SerializedStockItem }
  | { kind: 'replay'; status: number; body: unknown };

/**
 * `idempotencyKey` es el header `Idempotency-Key` opcional (Etapa 5C.1 —
 * 5C.2 lo hará obligatorio desde el frontend). Con clave: la reserva del
 * registro, el saldo, el movimiento, la auditoría y la respuesta armada
 * viven en UNA transacción — o todo confirma o nada. Sin clave: idéntico al
 * comportamiento de la Etapa 5A, sin registro alguno (y sin posibilidad de
 * replay: por eso la primera sobrecarga promete siempre `created`).
 */
export function createStockMovement(
  actor: StockActor,
  itemId: string,
  input: CreateMovementInput,
  meta: RequestMeta,
  now?: Date,
): Promise<Extract<CreateStockMovementResult, { kind: 'created' }>>;
export function createStockMovement(
  actor: StockActor,
  itemId: string,
  input: CreateMovementInput,
  meta: RequestMeta,
  now?: Date,
  idempotencyKey?: string,
): Promise<CreateStockMovementResult>;
export async function createStockMovement(
  actor: StockActor,
  itemId: string,
  input: CreateMovementInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
): Promise<CreateStockMovementResult> {
  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new IdempotencyKeyInvalidError();
  }
  if (ADMIN_ONLY_TYPES.has(input.type) && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede registrar ajustes de stock.');
  }
  if (input.destinationId && input.type !== 'CONSUMPTION') {
    throw new ValidationError('El destino solo aplica a consumos.');
  }
  // Cualquier usuario logueado registra ingresos y consumos ( BUSINESS_RULES
  // §1: "sin gate de admin"); el responsable de la operación sale SIEMPRE de
  // la sesión, nunca del body.
  if (actor.role !== 'ADMIN' && !actor.employeeId) {
    throw new EmployeeLinkRequiredError();
  }
  const employeeId = actor.employeeId;
  const quantity = new Prisma.Decimal(input.quantity);
  const { date: effectiveDate, text: effectiveDateText } = resolveEffectiveDate(
    input.effectiveDate,
    now,
    actor,
  );
  const decreasing = DECREASING_TYPES.has(input.type);
  const ctx: MovementWriteContext = {
    actor,
    itemId,
    input,
    employeeId,
    quantity,
    effectiveDate,
    effectiveDateText,
    decreasing,
    meta,
  };

  if (idempotencyKey === undefined) {
    const movementId = await prisma.$transaction((tx) => writeMovement(tx, ctx));
    const [movementRow, itemRow] = await Promise.all([
      prisma.stockMovement.findUnique({
        where: { id: movementId },
        select: movementSelect,
      }),
      prisma.stockItem.findUnique({ where: { id: itemId }, select: itemSelect }),
    ]);
    if (!movementRow || !itemRow) throw new StockItemNotFoundError();
    return {
      kind: 'created',
      movement: serializeMovement(movementRow),
      item: serializeItem(itemRow),
    };
  }

  // Endpoint lógico canónico: el UUID va en minúsculas para que el mismo
  // producto escrito con otra capitalización no abra una segunda reserva
  // (y con ella una segunda escritura) bajo la misma clave.
  const endpoint = `POST /stock/items/${itemId.toLowerCase()}/movements`;
  const requestHash = computeMovementRequestHash(endpoint, itemId, input, effectiveDateText);

  try {
    const response = await prisma.$transaction(
      async (tx) => {
        // 1) Reserva la clave PRIMERO: si cualquier paso posterior falla, la
        // transacción revierte y no queda ningún registro incompleto.
        const record = await tx.idempotencyRecord.create({
          data: { actorUserId: actor.userId, endpoint, key: idempotencyKey, requestHash },
        });
        // 2-4) saldo + movimiento + auditoría (mismo camino que sin clave)
        const movementId = await writeMovement(tx, ctx);
        // 5) respuesta armada DENTRO de la transacción para poder almacenarla
        const [movementRow, itemRow] = await Promise.all([
          tx.stockMovement.findUnique({ where: { id: movementId }, select: movementSelect }),
          tx.stockItem.findUnique({ where: { id: itemId }, select: itemSelect }),
        ]);
        if (!movementRow || !itemRow) throw new StockItemNotFoundError();
        const body = { movement: serializeMovement(movementRow), item: serializeItem(itemRow) };
        // 6) completa el registro en la MISMA transacción: al confirmar, la
        // respuesta ya está disponible para futuros replays.
        await tx.idempotencyRecord.update({
          where: { id: record.id },
          data: { responseStatus: 201, responseBody: body, completedAt: new Date() },
        });
        return body;
      },
      // El INSERT perdedor puede esperar el commit/rollback del ganador,
      // pero nunca indefinidamente. P2028 se traduce abajo a un 409
      // reintentable y no provoca una segunda escritura automática.
      { timeout: IDEMPOTENCY_TRANSACTION_TIMEOUT_MS },
    );
    return { kind: 'created', ...response };
  } catch (error) {
    if (isTransactionTimeout(error)) throw new IdempotencyRecordPendingError();
    if (!isUniqueViolationOn(error, IDEMPOTENCY_UNIQUE_FIELDS, IDEMPOTENCY_UNIQUE_INDEX)) {
      throw error;
    }
    // Único unique posible en este camino: la reserva (actor, endpoint, key)
    // — se insertó primero y, si existía una fila previa, el INSERT propio
    // falló ANTES de cualquier otra escritura. Por eso: si el registro no
    // existe tras el rollback, se responde como estado pendiente/reintentable:
    // no es seguro ejecutar otra vez ni filtrar el error interno de Prisma.
    // Si existe, se decide replay/conflicto/pendiente contra su estado real
    // — nunca se reejecuta a ciegas.
    const record = await prisma.idempotencyRecord.findUnique({
      where: {
        actorUserId_endpoint_key: {
          actorUserId: actor.userId,
          endpoint,
          key: idempotencyKey,
        },
      },
    });
    if (!record) throw new IdempotencyRecordPendingError();
    if (
      record.responseStatus === null ||
      record.responseBody === null ||
      record.completedAt === null
    ) {
      throw new IdempotencyRecordPendingError();
    }
    if (record.requestHash !== requestHash) throw new IdempotencyKeyConflictError();
    // Replay exacto: el status y el body almacenados, sin nuevo saldo,
    // movimiento ni auditoría.
    return { kind: 'replay', status: record.responseStatus, body: record.responseBody };
  }
}
