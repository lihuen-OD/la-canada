import { Prisma } from '../../generated/prisma/client';
import { matchesStockLevel, STOCK_LEVEL_IDS_SQL_PREFIX } from '../../stock/stockLevel';

/**
 * Fake de Prisma en memoria para el módulo Stock — implementa exactamente los
 * métodos que usa `stockService.ts`, nada más. Deliberadamente NO expone
 * `stockMovement.update` / `.delete` / `.updateMany` (el historial de
 * movimientos es inmutable) ni `consumptionDestination.delete` (los destinos
 * solo se inactivan, Etapa 5C.1): tests de la suite lo verifican. `$transaction`
 * toma/restaura un snapshot para imitar el rollback de PostgreSQL también
 * cuando el movimiento o la auditoría fallan después de actualizar el saldo,
 * y serializa las transacciones para poder ejercitar la colisión idempotente.
 * `$queryRaw` implementa UNA sola consulta — el filtro server-side por nivel
 * de `stock/stockLevel.ts` — con la misma semántica que su SQL y falla en
 * voz alta ante cualquier otra.
 */

type StockAreaValue = 'HOUSE' | 'GARDEN' | 'BOTH';
type ItemAreaValue = 'HOUSE' | 'GARDEN';
type MovementTypeValue =
  'OPENING_BALANCE' | 'INCOME' | 'CONSUMPTION' | 'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE';

export interface FakeStockCategory {
  id: string;
  name: string;
  area: StockAreaValue;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeStockItem {
  id: string;
  name: string;
  area: ItemAreaValue;
  categoryId: string;
  unit: string;
  minimumQuantity: string;
  currentQuantity: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeDestination {
  id: string;
  name: string;
  type: 'VEHICLE' | 'SECTOR';
  active: boolean;
}

export interface FakeEmployeeSummary {
  id: string;
  displayName: string;
  colorHex: string;
}

export interface FakeMovement {
  id: string;
  stockItemId: string;
  type: MovementTypeValue;
  quantity: string;
  effectiveDate: Date;
  employeeId: string | null;
  destinationId: string | null;
  reason: string | null;
  reference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeAuditRecord {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState?: unknown;
  newState?: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface FakeIdempotencyRecord {
  id: string;
  actorUserId: string;
  endpoint: string;
  key: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  completedAt: Date | null;
  createdAt: Date;
}

export interface FakeStockSeed {
  categories?: Omit<FakeStockCategory, 'createdAt' | 'updatedAt'>[];
  items?: Omit<FakeStockItem, 'createdAt' | 'updatedAt'>[];
  destinations?: FakeDestination[];
  employees?: FakeEmployeeSummary[];
  movements?: Omit<FakeMovement, 'createdAt' | 'updatedAt'>[];
}

export interface FakeStockCalls {
  stockItemUpdateMany: { where: unknown; data: unknown }[];
}

export interface FakeStockHooks {
  /** Se invoca ANTES de evaluar el `updateMany` del saldo (para simular una carrera). */
  beforeStockItemUpdateMany?: () => void;
  beforeIdempotencyRecordCreate?: () => void;
  beforeIdempotencyRecordUpdate?: () => void;
  beforeStockMovementCreate?: () => void;
  beforeAuditLogCreate?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- fake deliberadamente laxo, solo para tests */

/**
 * P2002 con la forma REAL de Prisma 7 + `@prisma/adapter-pg` (la del runtime
 * de producción): Postgres informa `23505` con el nombre del índice, el
 * adapter lo traduce a `UniqueConstraintViolation { constraint: { index } }`
 * y el cliente lo expone en `meta.driverAdapterError.cause` — sin
 * `meta.target`. Verificado contra `@prisma/adapter-pg@7.10.0`
 * (`dist/index.js`, caso "23505") y `@prisma/client/runtime/client.js`.
 */
export function fakeP2002(index: string, table?: string): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake-stock',
    meta: {
      ...(table ? { table } : {}),
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          kind: 'UniqueConstraintViolation',
          originalCode: '23505',
          constraint: { index },
          ...(table ? { table } : {}),
        },
      },
    },
  });
}

/** P2002 con la forma `meta.target` de engines/versiones anteriores (compatibilidad). */
export function fakeLegacyP2002(target: readonly string[]): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake-stock',
    meta: { target: [...target] },
  });
}

/** P2002 sin identidad de restricción: nunca debe tratarse como duplicado ni replay. */
export function fakeAnonymousP2002(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake-stock',
  });
}

export function fakeP2028(): never {
  throw new Prisma.PrismaClientKnownRequestError('Transaction timed out', {
    code: 'P2028',
    clientVersion: 'fake-stock',
  });
}

function decimal(value: unknown): InstanceType<typeof Prisma.Decimal> {
  return new Prisma.Decimal(String(value));
}

/** Postgres compara UUID sin distinguir mayúsculas; los ids del fake se guardan en minúsculas. */
function uuidKey(value: unknown): string {
  return String(value).toLowerCase();
}

const AREA_ORDER: Record<StockAreaValue, number> = { HOUSE: 0, GARDEN: 1, BOTH: 2 };

export interface FakeStockPrisma {
  api: any;
  calls: FakeStockCalls;
  hooks: FakeStockHooks;
  categories: Map<string, FakeStockCategory>;
  items: Map<string, FakeStockItem>;
  destinations: Map<string, FakeDestination>;
  employees: Map<string, FakeEmployeeSummary>;
  movements: FakeMovement[];
  auditLogs: FakeAuditRecord[];
  idempotencyRecords: FakeIdempotencyRecord[];
  reset(seed?: FakeStockSeed): void;
}

export function createFakeStockPrisma(seed: FakeStockSeed = {}): FakeStockPrisma {
  const categories = new Map<string, FakeStockCategory>();
  const items = new Map<string, FakeStockItem>();
  const destinations = new Map<string, FakeDestination>();
  const employees = new Map<string, FakeEmployeeSummary>();
  const movements: FakeMovement[] = [];
  const auditLogs: FakeAuditRecord[] = [];
  const idempotencyRecords: FakeIdempotencyRecord[] = [];
  const calls: FakeStockCalls = { stockItemUpdateMany: [] };
  const hooks: FakeStockHooks = {};
  let transactionTail: Promise<void> = Promise.resolve();
  const nextId = (): string => crypto.randomUUID();

  function reset(newSeed: FakeStockSeed = {}): void {
    categories.clear();
    items.clear();
    destinations.clear();
    employees.clear();
    movements.length = 0;
    auditLogs.length = 0;
    idempotencyRecords.length = 0;
    calls.stockItemUpdateMany.length = 0;
    hooks.beforeStockItemUpdateMany = undefined;
    hooks.beforeIdempotencyRecordCreate = undefined;
    hooks.beforeIdempotencyRecordUpdate = undefined;
    hooks.beforeStockMovementCreate = undefined;
    hooks.beforeAuditLogCreate = undefined;
    transactionTail = Promise.resolve();
    const now = new Date();
    for (const row of newSeed.categories ?? []) {
      categories.set(row.id, { ...row, createdAt: now, updatedAt: now });
    }
    for (const row of newSeed.items ?? []) {
      items.set(row.id, { ...row, createdAt: now, updatedAt: now });
    }
    for (const row of newSeed.destinations ?? []) destinations.set(row.id, row);
    for (const row of newSeed.employees ?? []) employees.set(row.id, row);
    for (const row of newSeed.movements ?? []) {
      movements.push({ ...row, createdAt: now, updatedAt: now });
    }
  }
  reset(seed);

  function withCategory(item: FakeStockItem) {
    const category = categories.get(item.categoryId);
    return {
      ...item,
      category: category
        ? { id: category.id, name: category.name, area: category.area }
        : undefined,
    };
  }

  function itemMatches(row: FakeStockItem, where: any = {}): boolean {
    if (where.id?.in !== undefined && !where.id.in.includes(row.id)) return false;
    if (where.active !== undefined && row.active !== where.active) return false;
    if (where.area !== undefined && row.area !== where.area) return false;
    if (where.categoryId !== undefined && row.categoryId !== where.categoryId) return false;
    if (where.name?.contains !== undefined) {
      const needle = String(where.name.contains).toLowerCase();
      if (!row.name.toLowerCase().includes(needle)) return false;
    }
    return true;
  }

  function sortItems(rows: FakeStockItem[]): FakeStockItem[] {
    return [...rows].sort(
      (a, b) => AREA_ORDER[a.area] - AREA_ORDER[b.area] || a.name.localeCompare(b.name, 'es'),
    );
  }

  function sortCategories(rows: FakeStockCategory[]): FakeStockCategory[] {
    return [...rows].sort(
      (a, b) => AREA_ORDER[a.area] - AREA_ORDER[b.area] || a.name.localeCompare(b.name, 'es'),
    );
  }

  function movementMatches(row: FakeMovement, where: any = {}): boolean {
    if (where.stockItemId !== undefined && row.stockItemId !== where.stockItemId) return false;
    if (where.type !== undefined && row.type !== where.type) return false;
    return true;
  }

  function withRelations(row: FakeMovement) {
    const destination = row.destinationId ? destinations.get(row.destinationId) : undefined;
    return {
      ...row,
      employee: row.employeeId ? (employees.get(row.employeeId) ?? null) : null,
      // Proyecta como el `select` real del service (sin `active`).
      destination: destination
        ? { id: destination.id, name: destination.name, type: destination.type }
        : null,
    };
  }

  function sortMovements(rows: FakeMovement[]): FakeMovement[] {
    return [...rows].sort(
      (a, b) =>
        b.effectiveDate.getTime() - a.effectiveDate.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  function paginate<T>(rows: T[], where: any): T[] {
    const skip = where?.skip ?? 0;
    const take = where?.take;
    const sliced = rows.slice(skip, take === undefined ? undefined : skip + take);
    return sliced;
  }

  const api: any = {
    stockCategory: {
      findUnique: async ({ where }: any) => categories.get(where.id) ?? null,
      findMany: async ({ where = {}, orderBy: _orderBy }: any = {}) => {
        let rows = [...categories.values()];
        if (where.active !== undefined) rows = rows.filter((r) => r.active === where.active);
        if (where.name !== undefined && where.area !== undefined) {
          rows = rows.filter((r) => r.name === where.name && r.area === where.area);
        }
        return sortCategories(rows);
      },
      create: async ({ data }: any) => {
        if ([...categories.values()].some((r) => r.name === data.name && r.area === data.area)) {
          fakeP2002('stock_categories_name_area_key', 'stock_categories');
        }
        const now = new Date();
        const row: FakeStockCategory = {
          active: true,
          ...data,
          id: data.id ?? nextId(),
          createdAt: now,
          updatedAt: now,
        };
        categories.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = categories.get(where.id);
        if (!existing) throw new Error('fakeStockPrisma: category not found');
        if (
          data.name !== undefined &&
          [...categories.values()].some(
            (r) => r.id !== where.id && r.name === data.name && r.area === existing.area,
          )
        ) {
          fakeP2002('stock_categories_name_area_key', 'stock_categories');
        }
        const updated = { ...existing, ...data, updatedAt: new Date() };
        categories.set(where.id, updated);
        return updated;
      },
    },
    stockItem: {
      findUnique: async ({ where }: any) => {
        const row = items.get(uuidKey(where.id));
        return row ? withCategory(row) : null;
      },
      findMany: async ({ where = {}, skip, take }: any = {}) => {
        const rows = sortItems([...items.values()].filter((row) => itemMatches(row, where)));
        return paginate(rows, { skip, take }).map(withCategory);
      },
      count: async ({ where = {} }: any = {}) =>
        [...items.values()].filter((row) => itemMatches(row, where)).length,
      create: async ({ data }: any) => {
        if ([...items.values()].some((r) => r.area === data.area && r.name === data.name)) {
          fakeP2002('stock_items_area_name_key', 'stock_items');
        }
        const now = new Date();
        const row: FakeStockItem = {
          active: true,
          ...data,
          minimumQuantity: String(data.minimumQuantity),
          currentQuantity: String(data.currentQuantity),
          id: data.id ?? nextId(),
          createdAt: now,
          updatedAt: now,
        };
        items.set(row.id, row);
        return withCategory(row);
      },
      update: async ({ where, data }: any) => {
        const existing = items.get(where.id);
        if (!existing) throw new Error('fakeStockPrisma: item not found');
        if (
          data.name !== undefined &&
          [...items.values()].some(
            (r) => r.id !== where.id && r.area === existing.area && r.name === data.name,
          )
        ) {
          fakeP2002('stock_items_area_name_key', 'stock_items');
        }
        const updated: FakeStockItem = {
          ...existing,
          ...data,
          minimumQuantity:
            data.minimumQuantity !== undefined
              ? String(data.minimumQuantity)
              : existing.minimumQuantity,
          updatedAt: new Date(),
        };
        items.set(where.id, updated);
        return withCategory(updated);
      },
      updateMany: async ({ where = {}, data }: any) => {
        calls.stockItemUpdateMany.push({ where, data });
        hooks.beforeStockItemUpdateMany?.();
        let count = 0;
        for (const item of items.values()) {
          if (where.id !== undefined && item.id !== uuidKey(where.id)) continue;
          if (where.active !== undefined && item.active !== where.active) continue;
          const gte = where.currentQuantity?.gte;
          if (gte !== undefined && !decimal(item.currentQuantity).gte(decimal(gte))) continue;
          const lte = where.currentQuantity?.lte;
          if (lte !== undefined && !decimal(item.currentQuantity).lte(decimal(lte))) continue;
          const op = data.currentQuantity;
          if (op && typeof op === 'object' && 'increment' in op) {
            item.currentQuantity = decimal(item.currentQuantity)
              .add(decimal((op as any).increment))
              .toString();
          }
          if (op && typeof op === 'object' && 'decrement' in op) {
            item.currentQuantity = decimal(item.currentQuantity)
              .sub(decimal((op as any).decrement))
              .toString();
          }
          item.updatedAt = new Date();
          count += 1;
        }
        return { count };
      },
    },
    stockMovement: {
      // Sin update/delete/updateMany a propósito: el historial es inmutable.
      create: async ({ data }: any) => {
        hooks.beforeStockMovementCreate?.();
        if (data.reference != null && movements.some((m) => m.reference === data.reference)) {
          fakeP2002('stock_movements_reference_key', 'stock_movements');
        }
        const now = new Date();
        const row: FakeMovement = {
          ...data,
          quantity: String(data.quantity),
          employeeId: data.employeeId ?? null,
          destinationId: data.destinationId ?? null,
          reason: data.reason ?? null,
          reference: data.reference ?? null,
          id: data.id ?? nextId(),
          createdAt: now,
          updatedAt: now,
        };
        movements.push(row);
        return row;
      },
      findUnique: async ({ where }: any) => {
        const row = movements.find((m) => m.id === where.id);
        return row ? withRelations(row) : null;
      },
      findMany: async ({ where = {}, skip, take }: any = {}) => {
        const rows = sortMovements(movements.filter((row) => movementMatches(row, where)));
        return paginate(rows, { skip, take }).map(withRelations);
      },
      count: async ({ where = {} }: any = {}) =>
        movements.filter((row) => movementMatches(row, where)).length,
    },
    consumptionDestination: {
      // Sin delete/deleteMany a propósito: los destinos solo se inactivan.
      findUnique: async ({ where }: any) => destinations.get(uuidKey(where.id)) ?? null,
      findMany: async ({ where = {} }: any = {}) => {
        let rows = [...destinations.values()];
        if (where.active !== undefined) rows = rows.filter((r) => r.active === where.active);
        return (
          [...rows]
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            // Proyecta como el `select` real del service.
            .map(({ id, name, type, active }) => ({ id, name, type, active }))
        );
      },
      create: async ({ data }: any) => {
        // `ConsumptionDestination.name` es @unique global en el schema.
        if ([...destinations.values()].some((r) => r.name === data.name)) {
          fakeP2002('consumption_destinations_name_key', 'consumption_destinations');
        }
        const row: FakeDestination = {
          active: true,
          ...data,
          id: data.id ?? nextId(),
        };
        destinations.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const existing = destinations.get(where.id);
        if (!existing) throw new Error('fakeStockPrisma: destination not found');
        if (
          data.name !== undefined &&
          [...destinations.values()].some((r) => r.id !== where.id && r.name === data.name)
        ) {
          fakeP2002('consumption_destinations_name_key', 'consumption_destinations');
        }
        const updated = { ...existing, ...data };
        destinations.set(where.id, updated);
        return updated;
      },
    },
    idempotencyRecord: {
      create: async ({ data }: any) => {
        hooks.beforeIdempotencyRecordCreate?.();
        // @@unique([actorUserId, endpoint, key]) — la colisión idempotente.
        if (
          idempotencyRecords.some(
            (r) =>
              r.actorUserId === data.actorUserId &&
              r.endpoint === data.endpoint &&
              r.key === data.key,
          )
        ) {
          fakeP2002('idempotency_records_actor_user_id_endpoint_key_key', 'idempotency_records');
        }
        const record: FakeIdempotencyRecord = {
          id: data.id ?? nextId(),
          responseStatus: null,
          responseBody: null,
          completedAt: null,
          createdAt: new Date(),
          ...data,
        };
        idempotencyRecords.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        hooks.beforeIdempotencyRecordUpdate?.();
        const record = idempotencyRecords.find((r) => r.id === where.id);
        if (!record) throw new Error('fakeStockPrisma: idempotency record not found');
        Object.assign(record, data);
        return record;
      },
      findUnique: async ({ where }: any) => {
        if (where.id !== undefined) {
          return idempotencyRecords.find((r) => r.id === where.id) ?? null;
        }
        const compound = where.actorUserId_endpoint_key;
        if (compound !== undefined) {
          return (
            idempotencyRecords.find(
              (r) =>
                r.actorUserId === compound.actorUserId &&
                r.endpoint === compound.endpoint &&
                r.key === compound.key,
            ) ?? null
          );
        }
        throw new Error('fakeStockPrisma: idempotency findUnique no soportado');
      },
    },
    /**
     * Única consulta SQL admitida: el filtro server-side por nivel de
     * `stock/stockLevel.ts`. El predicado es el mismo `matchesStockLevel`
     * que define la regla; el test de stockLevel fija el texto del SQL.
     */
    $queryRaw: async (query: any) => {
      const first = query?.strings?.[0];
      if (typeof first !== 'string' || !first.startsWith(STOCK_LEVEL_IDS_SQL_PREFIX)) {
        throw new Error(
          `fakeStockPrisma: consulta $queryRaw no soportada: ${String(first ?? query)}`,
        );
      }
      const level = query.values[0];
      if (level !== 'ok' && level !== 'low' && level !== 'critical') {
        throw new Error(`fakeStockPrisma: nivel de stock desconocido: ${String(level)}`);
      }
      return [...items.values()]
        .filter((row) => matchesStockLevel(row.currentQuantity, row.minimumQuantity, level))
        .map((row) => ({ id: row.id }));
    },
    auditLog: {
      create: async ({ data }: any) => {
        hooks.beforeAuditLogCreate?.();
        const record: FakeAuditRecord = {
          id: nextId(),
          createdAt: new Date(),
          ...data,
        };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const categorySnapshot: [string, FakeStockCategory][] = [...categories.entries()].map(
        ([id, row]) => [id, { ...row }],
      );
      const itemSnapshot: [string, FakeStockItem][] = [...items.entries()].map(([id, row]) => [
        id,
        { ...row },
      ]);
      const destinationSnapshot = [...destinations.values()].map((row) => ({ ...row }));
      const movementSnapshot = movements.map((row) => ({ ...row }));
      const auditSnapshot = auditLogs.map((row) => ({ ...row }));
      const idempotencySnapshot = idempotencyRecords.map((row) => ({ ...row }));
      try {
        return await fn(api);
      } catch (error) {
        categories.clear();
        for (const [id, row] of categorySnapshot) categories.set(id, row);
        items.clear();
        for (const [id, row] of itemSnapshot) items.set(id, row);
        destinations.clear();
        for (const row of destinationSnapshot) destinations.set(row.id, row);
        movements.splice(0, movements.length, ...movementSnapshot);
        auditLogs.splice(0, auditLogs.length, ...auditSnapshot);
        idempotencyRecords.splice(0, idempotencyRecords.length, ...idempotencySnapshot);
        throw error;
      } finally {
        release();
      }
    },
  };

  return {
    api,
    calls,
    hooks,
    categories,
    items,
    destinations,
    employees,
    movements,
    auditLogs,
    idempotencyRecords,
    reset,
  };
}

let current: FakeStockPrisma | null = null;

function ensure(): FakeStockPrisma {
  if (!current) current = createFakeStockPrisma();
  return current;
}

export function getFakeStockPrisma(): FakeStockPrisma {
  return ensure();
}

export function getFakeStockPrismaApi(): any {
  return ensure().api;
}

export function resetFakeStockPrisma(seed?: FakeStockSeed): void {
  ensure().reset(seed);
}
