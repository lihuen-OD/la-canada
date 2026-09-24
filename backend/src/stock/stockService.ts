import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  DuplicateStockCategoryError,
  DuplicateStockItemError,
  EmployeeLinkRequiredError,
  ForbiddenError,
  StockBalanceLimitError,
  StockCategoryInUseError,
  StockCategoryInactiveError,
  StockCategoryNotFoundError,
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
import type { createStockMovementBodySchema, listStockMovementsQuerySchema } from './stockSchemas';
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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function requireAdmin(actor: StockActor): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError();
}

const employeeSummarySelect = { id: true, displayName: true, colorHex: true } as const;

const categorySelect = { id: true, name: true, area: true, active: true } as const;

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
  page: number;
  pageSize: number;
}

export async function listStockItems(actor: StockActor, filters: ListStockItemsFilters) {
  if (filters.status !== 'active' && actor.role !== 'ADMIN') {
    throw new ForbiddenError('Solo un administrador puede ver productos inactivos.');
  }
  const where = {
    ...(filters.status === 'active' ? { active: true } : {}),
    ...(filters.status === 'inactive' ? { active: false } : {}),
    ...(filters.area ? { area: filters.area } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.q ? { name: { contains: filters.q, mode: 'insensitive' as const } } : {}),
  };
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

/** Solo destinos activos (el catálogo de destinos se administra en una etapa futura). */
export async function listStockDestinations() {
  const destinations = await prisma.consumptionDestination.findMany({
    where: { active: true },
    select: { id: true, name: true, type: true },
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
    if (isUniqueViolation(error)) throw new DuplicateStockCategoryError();
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
    if (isUniqueViolation(error)) throw new DuplicateStockCategoryError();
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
    if (isUniqueViolation(error)) throw new DuplicateStockItemError();
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
    if (isUniqueViolation(error)) throw new DuplicateStockItemError();
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

export async function createStockMovement(
  actor: StockActor,
  itemId: string,
  input: CreateMovementInput,
  meta: RequestMeta,
  now = new Date(),
) {
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

  const movementId = await prisma.$transaction(async (tx) => {
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
      ...meta,
    });
    return movement.id;
  });

  const [movementRow, itemRow] = await Promise.all([
    prisma.stockMovement.findUnique({
      where: { id: movementId },
      select: movementSelect,
    }),
    prisma.stockItem.findUnique({ where: { id: itemId }, select: itemSelect }),
  ]);
  if (!movementRow || !itemRow) throw new StockItemNotFoundError();
  return {
    movement: serializeMovement(movementRow),
    item: serializeItem(itemRow),
  };
}
