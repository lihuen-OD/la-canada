import { Prisma } from '../../generated/prisma/client';

/**
 * Fake de Prisma en memoria para el módulo Stock — implementa exactamente los
 * métodos que usa `stockService.ts`, nada más. deliberadamente NO expone
 * `stockMovement.update` / `.delete` / `.updateMany`: el historial de
 * movimientos es inmutable y un test de la suite lo verifica. `$transaction`
 * toma/restaura un snapshot para imitar el rollback de PostgreSQL también
 * cuando el movimiento o la auditoría fallan después de actualizar el saldo.
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
  beforeStockMovementCreate?: () => void;
  beforeAuditLogCreate?: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- fake deliberadamente laxo, solo para tests */

function p2002(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake-stock',
  });
}

function decimal(value: unknown): InstanceType<typeof Prisma.Decimal> {
  return new Prisma.Decimal(String(value));
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
  reset(seed?: FakeStockSeed): void;
}

export function createFakeStockPrisma(seed: FakeStockSeed = {}): FakeStockPrisma {
  const categories = new Map<string, FakeStockCategory>();
  const items = new Map<string, FakeStockItem>();
  const destinations = new Map<string, FakeDestination>();
  const employees = new Map<string, FakeEmployeeSummary>();
  const movements: FakeMovement[] = [];
  const auditLogs: FakeAuditRecord[] = [];
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
    calls.stockItemUpdateMany.length = 0;
    hooks.beforeStockItemUpdateMany = undefined;
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
          p2002();
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
          p2002();
        }
        const updated = { ...existing, ...data, updatedAt: new Date() };
        categories.set(where.id, updated);
        return updated;
      },
    },
    stockItem: {
      findUnique: async ({ where }: any) => {
        const row = items.get(where.id);
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
          p2002();
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
          p2002();
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
          if (where.id !== undefined && item.id !== where.id) continue;
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
          p2002();
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
      findUnique: async ({ where }: any) => destinations.get(where.id) ?? null,
      findMany: async ({ where = {} }: any = {}) => {
        let rows = [...destinations.values()];
        if (where.active !== undefined) rows = rows.filter((r) => r.active === where.active);
        return (
          [...rows]
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            // Proyecta como el `select` real del service (sin `active`).
            .map(({ id, name, type }) => ({ id, name, type }))
        );
      },
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
      const movementSnapshot = movements.map((row) => ({ ...row }));
      const auditSnapshot = auditLogs.map((row) => ({ ...row }));
      try {
        return await fn(api);
      } catch (error) {
        categories.clear();
        for (const [id, row] of categorySnapshot) categories.set(id, row);
        items.clear();
        for (const [id, row] of itemSnapshot) items.set(id, row);
        movements.splice(0, movements.length, ...movementSnapshot);
        auditLogs.splice(0, auditLogs.length, ...auditSnapshot);
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
