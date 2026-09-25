import { beforeEach, describe, expect, it, vi } from 'vitest';
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
} from '../../errors/AppError';
import {
  computeMovementRequestHash,
  createStockCategory,
  createStockDestination,
  createStockItem,
  createStockMovement,
  getStockItem,
  listStockCategories,
  listStockDestinations,
  listStockItems,
  listStockMovements,
  setStockItemActive,
  updateStockCategory,
  updateStockDestination,
  updateStockItem,
  type CreateStockMovementResult,
  type RequestMeta,
  type StockActor,
} from '../../stock/stockService';
import {
  fakeAnonymousP2002,
  fakeLegacyP2002,
  fakeP2002,
  fakeP2028,
  getFakeStockPrisma,
  resetFakeStockPrisma,
} from './fakeStockPrisma';

vi.mock('../../lib/prisma', async () => {
  const { getFakeStockPrismaApi } = await import('./fakeStockPrisma.js');
  return {
    get prisma() {
      return getFakeStockPrismaApi();
    },
  };
});

const CAT_HOUSE = '11111111-1111-4111-8111-111111111111';
const CAT_GARDEN = '22222222-2222-4222-8222-222222222222';
const CAT_INACTIVE = '33333333-3333-4333-8333-333333333333';
const CAT_EMPTY = '33333333-3333-4333-8333-444444444444';
const ITEM_DETERGENTE = '44444444-4444-4444-8444-444444444444';
const ITEM_PAPEL = '55555555-5555-4555-8555-555555555555';
const ITEM_FERTILIZANTE = '66666666-6666-4666-8666-666666666666';
const ITEM_INEXISTENTE = '77777777-7777-4777-8777-777777777777';
const DEST_OPERATIVO = '88888888-8888-4888-8888-888888888888';
const DEST_INACTIVO = '99999999-9999-4999-8999-999999999999';
const DEST_INEXISTENTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EMP_JUAN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_EMPLOYEE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_NO_LINK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const admin: StockActor = { userId: USER_ADMIN, role: 'ADMIN', employeeId: null };
const employee: StockActor = { userId: USER_EMPLOYEE, role: 'EMPLOYEE', employeeId: EMP_JUAN };
const employeeNoLink: StockActor = {
  userId: USER_NO_LINK,
  role: 'EMPLOYEE',
  employeeId: null,
};
const meta: RequestMeta = { ipAddress: null, userAgent: null };

function seed() {
  return {
    categories: [
      { id: CAT_HOUSE, name: 'Limpieza', area: 'HOUSE' as const, active: true },
      { id: CAT_GARDEN, name: 'Fertilizantes', area: 'GARDEN' as const, active: true },
      { id: CAT_INACTIVE, name: 'Varios', area: 'HOUSE' as const, active: false },
      { id: CAT_EMPTY, name: 'Sin productos', area: 'HOUSE' as const, active: true },
    ],
    items: [
      {
        id: ITEM_DETERGENTE,
        name: 'Detergente',
        area: 'HOUSE' as const,
        categoryId: CAT_HOUSE,
        unit: 'litros',
        minimumQuantity: '3',
        currentQuantity: '2',
        active: true,
      },
      {
        id: ITEM_PAPEL,
        name: 'Papel higiénico',
        area: 'HOUSE' as const,
        categoryId: CAT_HOUSE,
        unit: 'rollos',
        minimumQuantity: '12',
        currentQuantity: '24',
        active: false,
      },
      {
        id: ITEM_FERTILIZANTE,
        name: 'Fertilizante NPK',
        area: 'GARDEN' as const,
        categoryId: CAT_GARDEN,
        unit: 'kg',
        minimumQuantity: '10',
        currentQuantity: '5',
        active: true,
      },
    ],
    destinations: [
      { id: DEST_OPERATIVO, name: 'Camioneta', type: 'VEHICLE' as const, active: true },
      { id: DEST_INACTIVO, name: 'Cochera', type: 'SECTOR' as const, active: false },
    ],
    employees: [{ id: EMP_JUAN, displayName: 'Juan Pérez', colorHex: '#336699' }],
    movements: [
      {
        id: 'f0000000-0000-4000-8000-000000000001',
        stockItemId: ITEM_DETERGENTE,
        type: 'OPENING_BALANCE' as const,
        quantity: '2',
        effectiveDate: new Date(Date.UTC(2026, 8, 1)),
        employeeId: null,
        destinationId: null,
        reason: null,
        reference: 'HOUSE::Detergente::OPENING_BALANCE',
      },
      {
        id: 'f0000000-0000-4000-8000-000000000002',
        stockItemId: ITEM_DETERGENTE,
        type: 'CONSUMPTION' as const,
        quantity: '1',
        effectiveDate: new Date(Date.UTC(2026, 8, 20)),
        employeeId: EMP_JUAN,
        destinationId: DEST_OPERATIVO,
        reason: 'Limpieza general',
        reference: null,
      },
    ],
  };
}

beforeEach(() => {
  resetFakeStockPrisma(seed());
});

describe('semántica HTTP y códigos estables de Stock', () => {
  it.each([
    [new StockItemNotFoundError(), 404, 'STOCK_ITEM_NOT_FOUND'],
    [new StockCategoryNotFoundError(), 404, 'STOCK_CATEGORY_NOT_FOUND'],
    [new StockDestinationNotFoundError(), 404, 'STOCK_DESTINATION_NOT_FOUND'],
    [new StockItemInactiveError(), 409, 'STOCK_ITEM_INACTIVE'],
    [new StockCategoryInactiveError(), 409, 'STOCK_CATEGORY_INACTIVE'],
    [new StockDestinationInactiveError(), 409, 'STOCK_DESTINATION_INACTIVE'],
    [new StockInsufficientQuantityError(), 409, 'STOCK_INSUFFICIENT_QUANTITY'],
    [new DuplicateStockItemError(), 409, 'STOCK_ITEM_DUPLICATE'],
    [new DuplicateStockCategoryError(), 409, 'STOCK_CATEGORY_DUPLICATE'],
    [new StockCategoryInUseError(), 409, 'STOCK_CATEGORY_IN_USE'],
    [new StockBalanceLimitError(), 409, 'STOCK_BALANCE_LIMIT'],
    [new StockDestinationDuplicateError(), 409, 'STOCK_DESTINATION_DUPLICATE'],
    [new IdempotencyKeyInvalidError(), 400, 'IDEMPOTENCY_KEY_INVALID'],
    [new IdempotencyKeyConflictError(), 409, 'IDEMPOTENCY_KEY_CONFLICT'],
    [new IdempotencyRecordPendingError(), 409, 'IDEMPOTENCY_RECORD_PENDING'],
  ])('%s → %i %s', (error, statusCode, code) => {
    expect(error).toMatchObject({ statusCode, code, isOperational: true });
  });
});

// ── Consulta ──────────────────────────────────────────────────────────────

describe('listStockItems', () => {
  it('por defecto lista solo activos y filtra/ordena/pagina', async () => {
    const { items, total, totalPages } = await listStockItems(admin, {
      status: 'active',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(2);
    expect(totalPages).toBe(1);
    expect(items.map((item) => item.name)).toEqual(['Detergente', 'Fertilizante NPK']);
    expect(items[0]?.currentQuantity).toBe('2');
  });

  it('un EMPLOYEE no puede ver inactivos (status distinto de active)', async () => {
    await expect(
      listStockItems(employee, { status: 'all', page: 1, pageSize: 50 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      listStockItems(employee, { status: 'inactive', page: 1, pageSize: 50 }),
    ).rejects.toThrow('Solo un administrador puede ver productos inactivos.');
  });

  it('un ADMIN sí ve inactivos con status=all', async () => {
    const { total } = await listStockItems(admin, {
      status: 'all',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(3);
  });

  it('filtra por área, búsqueda textual y pagina', async () => {
    const house = await listStockItems(employee, {
      status: 'active',
      area: 'HOUSE',
      page: 1,
      pageSize: 50,
    });
    expect(house.items.map((item) => item.name)).toEqual(['Detergente']);

    const search = await listStockItems(admin, {
      status: 'active',
      q: 'DETER',
      page: 1,
      pageSize: 50,
    });
    expect(search.items.map((item) => item.name)).toEqual(['Detergente']);

    const page1 = await listStockItems(admin, {
      status: 'active',
      page: 1,
      pageSize: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);
  });
});

describe('listStockItems — filtro server-side por stockLevel', () => {
  it('filtra low sobre activos y devuelve el nivel calculado en el DTO', async () => {
    const { items, total } = await listStockItems(admin, {
      status: 'active',
      stockLevel: 'low',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(2);
    expect(items.map((item) => item.name)).toEqual(['Detergente', 'Fertilizante NPK']);
    expect(items.every((item) => item.stockLevel === 'low')).toBe(true);
    expect(items[0]?.stockLevel).toBe('low');
    expect(items[0]).not.toHaveProperty('barPercent');
  });

  it('ok con status=all incluye al producto inactivo (conserva su nivel matemático)', async () => {
    const { items, total } = await listStockItems(admin, {
      status: 'all',
      stockLevel: 'ok',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(1);
    expect(items[0]?.name).toBe('Papel higiénico');
    expect(items[0]?.stockLevel).toBe('ok');
    expect(items[0]?.active).toBe(false);
  });

  it('critical detecta saldo en cero aunque el mínimo también sea 0', async () => {
    const fake = getFakeStockPrisma();
    const fertilizante = fake.items.get(ITEM_FERTILIZANTE)!;
    fertilizante.currentQuantity = '0';
    fertilizante.minimumQuantity = '0';
    const { items, total } = await listStockItems(admin, {
      status: 'active',
      stockLevel: 'critical',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(1);
    expect(items[0]?.name).toBe('Fertilizante NPK');
    expect(items[0]?.stockLevel).toBe('critical');
  });

  it('se combina con los filtros existentes y pagina DESPUÉS del filtro', async () => {
    const garden = await listStockItems(admin, {
      status: 'active',
      stockLevel: 'low',
      area: 'GARDEN',
      page: 1,
      pageSize: 50,
    });
    expect(garden.items.map((item) => item.name)).toEqual(['Fertilizante NPK']);

    const page1 = await listStockItems(admin, {
      status: 'active',
      stockLevel: 'low',
      page: 1,
      pageSize: 1,
    });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.totalPages).toBe(2);

    const none = await listStockItems(admin, {
      status: 'active',
      stockLevel: 'ok',
      page: 1,
      pageSize: 50,
    });
    expect(none.items).toEqual([]);
    expect(none.total).toBe(0);
    expect(none.totalPages).toBe(1);
  });

  it('un EMPLOYEE puede filtrar por nivel (no es permiso de administración)', async () => {
    const { total } = await listStockItems(employee, {
      status: 'active',
      stockLevel: 'low',
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(2);
  });
});

describe('listStockCategories / listStockDestinations / getStockItem', () => {
  it('lista solo categorías activas por defecto, Casa antes que Jardín', async () => {
    const { categories } = await listStockCategories(admin, { status: 'active' });
    expect(categories.map((category) => category.name)).toEqual([
      'Limpieza',
      'Sin productos',
      'Fertilizantes',
    ]);
    expect(categories.every((category) => category.active)).toBe(true);
  });

  it('status=all es de ADMIN', async () => {
    const { categories } = await listStockCategories(admin, { status: 'all' });
    expect(categories).toHaveLength(4);
    await expect(listStockCategories(employee, { status: 'all' })).rejects.toThrow(
      'Solo un administrador puede ver categorías inactivas.',
    );
  });

  it('lista solo destinos activos por defecto (con su estado)', async () => {
    const { destinations } = await listStockDestinations(admin, { status: 'active' });
    expect(destinations).toEqual([
      { id: DEST_OPERATIVO, name: 'Camioneta', type: 'VEHICLE', active: true },
    ]);
  });

  it('detalle de producto inexistente → 404', async () => {
    await expect(getStockItem(ITEM_INEXISTENTE)).rejects.toMatchObject({
      statusCode: 404,
      code: 'STOCK_ITEM_NOT_FOUND',
    });
  });
});

describe('listStockDestinations — status=all es de ADMIN', () => {
  it('muestra los inactivos con su estado', async () => {
    const { destinations } = await listStockDestinations(admin, { status: 'all' });
    expect(destinations.map((destination) => destination.name)).toEqual(['Camioneta', 'Cochera']);
    expect(destinations.find((destination) => destination.name === 'Cochera')?.active).toBe(false);
  });

  it('un EMPLOYEE no ve destinos inactivos', async () => {
    await expect(listStockDestinations(employee, { status: 'all' })).rejects.toThrow(
      'Solo un administrador puede ver destinos inactivos.',
    );
  });
});

describe('createStockDestination / updateStockDestination (Etapa 5C.1)', () => {
  it('un EMPLOYEE no administra destinos', async () => {
    await expect(
      createStockDestination(employee, { name: 'Atajo', type: 'SECTOR' }, meta),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateStockDestination(employee, DEST_OPERATIVO, { active: false }, meta),
    ).rejects.toThrow(ForbiddenError);
  });

  it('crea un destino y audita stock.destination.created', async () => {
    const { destination } = await createStockDestination(
      admin,
      { name: 'Atajo del fondo', type: 'SECTOR' },
      meta,
    );
    expect(destination).toMatchObject({
      name: 'Atajo del fondo',
      type: 'SECTOR',
      active: true,
    });
    const log = getFakeStockPrisma().auditLogs.find(
      (entry) => entry.action === 'stock.destination.created',
    );
    expect(log?.entityType).toBe('ConsumptionDestination');
    expect(log?.newState).toMatchObject({ name: 'Atajo del fondo', type: 'SECTOR', active: true });
  });

  it('nombre duplicado (global) → 409 controlado', async () => {
    await expect(
      createStockDestination(admin, { name: 'Camioneta', type: 'VEHICLE' }, meta),
    ).rejects.toThrow(StockDestinationDuplicateError);
  });

  it('si falla la auditoría se revierte el destino (sin altas parciales)', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeAuditLogCreate = () => {
      throw new Error('fallo sintético de auditoría');
    };
    await expect(
      createStockDestination(admin, { name: 'Temporal', type: 'SECTOR' }, meta),
    ).rejects.toThrow('fallo sintético de auditoría');
    fake.hooks.beforeAuditLogCreate = undefined;
    expect([...fake.destinations.values()].some((row) => row.name === 'Temporal')).toBe(false);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('si falla la segunda auditoría se revierten juntos nombre, estado y ambos logs', async () => {
    const fake = getFakeStockPrisma();
    let auditCalls = 0;
    fake.hooks.beforeAuditLogCreate = () => {
      auditCalls += 1;
      if (auditCalls === 2) throw new Error('fallo sintético en segunda auditoría');
    };
    await expect(
      updateStockDestination(
        admin,
        DEST_OPERATIVO,
        { name: 'Nombre transitorio', active: false },
        meta,
      ),
    ).rejects.toThrow('fallo sintético en segunda auditoría');
    expect(fake.destinations.get(DEST_OPERATIVO)).toMatchObject({
      name: 'Camioneta',
      active: true,
    });
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('renombrar audita stock.destination.updated con valor anterior y nuevo', async () => {
    const { destination } = await updateStockDestination(
      admin,
      DEST_OPERATIVO,
      { name: 'Camioneta 2' },
      meta,
    );
    expect(destination.name).toBe('Camioneta 2');
    const log = getFakeStockPrisma().auditLogs.find(
      (entry) => entry.action === 'stock.destination.updated',
    );
    expect(log?.previousState).toEqual({ name: 'Camioneta' });
    expect(log?.newState).toEqual({ name: 'Camioneta 2' });
  });

  it('cambiar estado audita stock.destination.status_changed de forma separada', async () => {
    const { destination } = await updateStockDestination(
      admin,
      DEST_OPERATIVO,
      { active: false },
      meta,
    );
    expect(destination.active).toBe(false);
    const log = getFakeStockPrisma().auditLogs.find(
      (entry) => entry.action === 'stock.destination.status_changed',
    );
    expect(log?.previousState).toEqual({ active: true });
    expect(log?.newState).toEqual({ active: false });
  });

  it('renombrar y cambiar estado deja DOS auditorías (una por acción)', async () => {
    await updateStockDestination(
      admin,
      DEST_OPERATIVO,
      { name: 'Camioneta nueva', active: false },
      meta,
    );
    const actions = getFakeStockPrisma().auditLogs.map((entry) => entry.action);
    expect(actions.filter((action) => action === 'stock.destination.updated')).toHaveLength(1);
    expect(actions.filter((action) => action === 'stock.destination.status_changed')).toHaveLength(
      1,
    );
  });

  it('un destino con movimientos históricos se puede inactivar y NUNCA se borra', async () => {
    // DEST_OPERATIVO tiene un consumo en el seed.
    await updateStockDestination(admin, DEST_OPERATIVO, { active: false }, meta);
    const fake = getFakeStockPrisma();
    expect(fake.destinations.has(DEST_OPERATIVO)).toBe(true);
    expect(fake.movements.some((movement) => movement.destinationId === DEST_OPERATIVO)).toBe(true);
    expect((fake.api.consumptionDestination as Record<string, unknown>).delete).toBeUndefined();
    expect((fake.api.consumptionDestination as Record<string, unknown>).deleteMany).toBeUndefined();
  });

  it('un body sin cambios no genera auditoría', async () => {
    await updateStockDestination(admin, DEST_OPERATIVO, { name: 'Camioneta' }, meta);
    expect(getFakeStockPrisma().auditLogs).toHaveLength(0);
  });

  it('destino inexistente → 404; rename hacia un nombre usado → 409', async () => {
    await expect(
      updateStockDestination(admin, DEST_INEXISTENTE, { name: 'Otro' }, meta),
    ).rejects.toThrow(StockDestinationNotFoundError);
    await expect(
      updateStockDestination(admin, DEST_INACTIVO, { name: 'Camioneta' }, meta),
    ).rejects.toThrow(StockDestinationDuplicateError);
  });
});

describe('listStockMovements (histórico)', () => {
  it('exige que el producto exista', async () => {
    await expect(listStockMovements(ITEM_INEXISTENTE, { page: 1, pageSize: 50 })).rejects.toThrow(
      'Producto no encontrado.',
    );
  });

  it('devuelve el histórico con persona y destino, más reciente primero', async () => {
    const { movements, total } = await listStockMovements(ITEM_DETERGENTE, {
      page: 1,
      pageSize: 50,
    });
    expect(total).toBe(2);
    expect(movements[0]?.type).toBe('CONSUMPTION');
    expect(movements[0]?.employee).toEqual({
      id: EMP_JUAN,
      displayName: 'Juan Pérez',
      colorHex: '#336699',
    });
    expect(movements[0]?.destination).toEqual({
      id: DEST_OPERATIVO,
      name: 'Camioneta',
      type: 'VEHICLE',
    });
    expect(movements[0]?.effectiveDate).toBe('2026-09-20');
    expect(movements[1]?.type).toBe('OPENING_BALANCE');
    expect(movements[1]?.employee).toBeNull();
  });

  it('filtra por tipo', async () => {
    const { movements } = await listStockMovements(ITEM_DETERGENTE, {
      type: 'OPENING_BALANCE',
      page: 1,
      pageSize: 50,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe('OPENING_BALANCE');
  });
});

// ── Administración del catálogo ───────────────────────────────────────────

describe('createStockCategory / updateStockCategory', () => {
  it('un EMPLOYEE no administra categorías', async () => {
    await expect(
      createStockCategory(employee, { name: 'Nueva', area: 'HOUSE' }, meta),
    ).rejects.toThrow(ForbiddenError);
  });

  it('crea una categoría y audita', async () => {
    const { category } = await createStockCategory(
      admin,
      { name: 'Semillas', area: 'GARDEN' },
      meta,
    );
    expect(category.name).toBe('Semillas');
    expect(category.active).toBe(true);
    const fake = getFakeStockPrisma();
    expect(fake.auditLogs.map((log) => log.action)).toContain('stock.category.created');
  });

  it('nombre duplicado en el mismo área → 409 controlado', async () => {
    await expect(
      createStockCategory(admin, { name: 'Limpieza', area: 'HOUSE' }, meta),
    ).rejects.toThrow(DuplicateStockCategoryError);
  });

  it('desactiva una categoría vacía con auditoría', async () => {
    const { category } = await updateStockCategory(admin, CAT_EMPTY, { active: false }, meta);
    expect(category.active).toBe(false);
    const fake = getFakeStockPrisma();
    const log = fake.auditLogs.find((entry) => entry.action === 'stock.category.updated');
    expect(log?.previousState).toEqual({ active: true });
    expect(log?.newState).toEqual({ active: false });
  });

  it('no desactiva una categoría con productos activos', async () => {
    await expect(updateStockCategory(admin, CAT_HOUSE, { active: false }, meta)).rejects.toThrow(
      StockCategoryInUseError,
    );
    expect(getFakeStockPrisma().categories.get(CAT_HOUSE)?.active).toBe(true);
  });
});

describe('createStockItem', () => {
  const input = {
    name: 'Trapos de piso',
    area: 'HOUSE' as const,
    categoryId: CAT_HOUSE,
    unit: 'unidades',
    minimumQuantity: '4',
  };

  it('un EMPLOYEE no crea productos', async () => {
    await expect(createStockItem(employee, input, meta)).rejects.toThrow(ForbiddenError);
  });

  it('crea con saldo 0 (sin movimiento OPENING_BALANCE) y audita', async () => {
    const { item } = await createStockItem(admin, input, meta);
    expect(item.currentQuantity).toBe('0');
    expect(item.active).toBe(true);
    expect(item.category).toEqual({ id: CAT_HOUSE, name: 'Limpieza', area: 'HOUSE' });
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(2); // solo los del seed
    const log = fake.auditLogs.find((entry) => entry.action === 'stock.item.created');
    expect(log).toBeDefined();
  });

  it('nombre duplicado en el área → 409', async () => {
    await expect(
      createStockItem(admin, { ...input, name: 'Detergente', minimumQuantity: '5' }, meta),
    ).rejects.toThrow(DuplicateStockItemError);
  });

  it('categoría inactiva → 409', async () => {
    await expect(
      createStockItem(admin, { ...input, categoryId: CAT_INACTIVE }, meta),
    ).rejects.toThrow(StockCategoryInactiveError);
  });

  it('categoría inexistente → 404; categoría de otra área → 400', async () => {
    await expect(
      createStockItem(admin, { ...input, categoryId: ITEM_INEXISTENTE }, meta),
    ).rejects.toThrow(StockCategoryNotFoundError);
    await expect(
      createStockItem(admin, { ...input, area: 'GARDEN', categoryId: CAT_HOUSE }, meta),
    ).rejects.toThrow('La categoría no corresponde al área indicada.');
  });
});

describe('updateStockItem / setStockItemActive', () => {
  it('cambia nombre y mínimo sin tocar el saldo, con auditoría', async () => {
    const result = await updateStockItem(
      admin,
      ITEM_DETERGENTE,
      { name: 'Detergente 2L', minimumQuantity: '4' },
      meta,
    );
    expect(result.item.name).toBe('Detergente 2L');
    expect(result.item.minimumQuantity).toBe('4');
    expect(result.item.currentQuantity).toBe('2'); // intocado
    const fake = getFakeStockPrisma();
    const log = fake.auditLogs.find((entry) => entry.action === 'stock.item.updated');
    expect(log?.previousState).toMatchObject({ name: 'Detergente', minimumQuantity: '3' });
    expect(log?.newState).toMatchObject({ name: 'Detergente 2L', minimumQuantity: '4' });
  });

  it('producto inexistente → 404', async () => {
    await expect(updateStockItem(admin, ITEM_INEXISTENTE, { name: 'Otro' }, meta)).rejects.toThrow(
      'Producto no encontrado.',
    );
  });

  it('desactiva sin borrar y audita una sola vez', async () => {
    const first = await setStockItemActive(admin, ITEM_DETERGENTE, false, meta);
    expect(first.item.active).toBe(false);
    await setStockItemActive(admin, ITEM_DETERGENTE, false, meta);
    const fake = getFakeStockPrisma();
    const deactivations = fake.auditLogs.filter(
      (entry) => entry.action === 'stock.item.deactivated',
    );
    expect(deactivations).toHaveLength(1);
    expect(fake.items.has(ITEM_DETERGENTE)).toBe(true); // nunca borrado
  });

  it('un EMPLOYEE no administra productos', async () => {
    await expect(setStockItemActive(employee, ITEM_DETERGENTE, false, meta)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

// ── Movimientos ───────────────────────────────────────────────────────────

describe('createStockMovement — permisos', () => {
  it('un EMPLOYEE registra consumo y lo firma con su empleado', async () => {
    const { movement, item } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
    );
    expect(movement.type).toBe('CONSUMPTION');
    expect(movement.quantity).toBe('0.5');
    expect(movement.employee).toEqual({
      id: EMP_JUAN,
      displayName: 'Juan Pérez',
      colorHex: '#336699',
    });
    expect(item.currentQuantity).toBe('1.5');
    const fake = getFakeStockPrisma();
    expect(fake.auditLogs.map((entry) => entry.action)).toContain('stock.movement.created');
  });

  it('un EMPLOYEE también registra ingresos (decisión de etapa: como el prototipo)', async () => {
    const { item } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      meta,
    );
    expect(item.currentQuantity).toBe('3');
  });

  it('un EMPLOYEE NO registra ajustes (eso es de ADMIN)', async () => {
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'ADJUSTMENT_DECREASE', quantity: '1' },
        meta,
      ),
    ).rejects.toThrow('Solo un administrador puede registrar ajustes de stock.');
  });

  it('un ADMIN registra ajustes', async () => {
    const { item, movement } = await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'ADJUSTMENT_INCREASE', quantity: '1.5' },
      meta,
    );
    expect(movement.type).toBe('ADJUSTMENT_INCREASE');
    expect(item.currentQuantity).toBe('3.5');
  });

  it('los ajustes expresan dirección con tipos distintos y cantidad siempre positiva', async () => {
    const increase = await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'ADJUSTMENT_INCREASE', quantity: '1.25' },
      meta,
    );
    expect(increase.item.currentQuantity).toBe('3.25');
    const decrease = await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'ADJUSTMENT_DECREASE', quantity: '0.25' },
      meta,
    );
    expect(decrease.item.currentQuantity).toBe('3');
    expect(decrease.movement.quantity).toBe('0.25');
  });

  it('un EMPLOYEE sin empleado vinculado no puede operar', async () => {
    await expect(
      createStockMovement(
        employeeNoLink,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1' },
        meta,
      ),
    ).rejects.toThrow(EmployeeLinkRequiredError);
  });
});

describe('createStockMovement — invariantes de saldo', () => {
  it('el saldo nunca queda negativo: consumo mayor al saldo → 409 y sin movimiento', async () => {
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'CONSUMPTION', quantity: '5' }, meta),
    ).rejects.toThrow(StockInsufficientQuantityError);
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'CONSUMPTION', quantity: '5' }, meta),
    ).rejects.toThrow('(2 litros)');
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(2); // sin altas nuevas
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
    expect(fake.calls.stockItemUpdateMany).toHaveLength(0); // ni llegó a la condición atómica
  });

  it('consumo exactamente igual al saldo → queda en 0 (no negativo)', async () => {
    const { item } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '2' },
      meta,
    );
    expect(item.currentQuantity).toBe('0');
    expect(getFakeStockPrisma().movements).toHaveLength(3);
  });

  it('la condición atómica es currentQuantity >= cantidad (nunca lectura-cálculo-escritura sin condición)', async () => {
    await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      meta,
    );
    const fake = getFakeStockPrisma();
    const call = fake.calls.stockItemUpdateMany.at(-1);
    expect(call?.where).toMatchObject({
      id: ITEM_DETERGENTE,
      currentQuantity: { gte: expect.anything() },
    });
    expect(call?.data).toMatchObject({
      currentQuantity: { decrement: expect.anything() },
    });
  });

  it('carrera: si el saldo cambia entre la lectura y la actualización condicional, se revierte todo (409, sin movimiento)', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeStockItemUpdateMany = () => {
      // Simula otro consumo concurrente que vació el saldo.
      const item = fake.items.get(ITEM_DETERGENTE);
      if (item) item.currentQuantity = '0';
    };
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'CONSUMPTION', quantity: '1' }, meta),
    ).rejects.toThrow(StockInsufficientQuantityError);
    fake.hooks.beforeStockItemUpdateMany = undefined;
    expect(fake.movements).toHaveLength(2); // la carrera no creó movimiento
    expect(fake.auditLogs.map((entry) => entry.action)).not.toContain('stock.movement.created');
  });

  it('dos consumos concurrentes no pueden dejar saldo negativo', async () => {
    const results = await Promise.allSettled([
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1.5' },
        meta,
      ),
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1.5' },
        meta,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(getFakeStockPrisma().items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('0.5');
  });

  it('dos ingresos concurrentes no pierden incrementos', async () => {
    await Promise.all([
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'INCOME', quantity: '1.25' }, meta),
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'INCOME', quantity: '2.50' }, meta),
    ]);
    expect(getFakeStockPrisma().items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('5.75');
  });

  it('revierte el saldo y no crea auditoría si falla la creación del movimiento', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeStockMovementCreate = () => {
      throw new Error('fallo sintético de movimiento');
    };
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'INCOME', quantity: '1' }, meta),
    ).rejects.toThrow('fallo sintético de movimiento');
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
    expect(fake.movements).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('revierte saldo y movimiento si falla la auditoría', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeAuditLogCreate = () => {
      throw new Error('fallo sintético de auditoría');
    };
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'INCOME', quantity: '1' }, meta),
    ).rejects.toThrow('fallo sintético de auditoría');
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
    expect(fake.movements).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('rechaza incrementos que exceden Decimal(10,2)', async () => {
    const fake = getFakeStockPrisma();
    const item = fake.items.get(ITEM_DETERGENTE)!;
    item.currentQuantity = '99999999.99';
    await expect(
      createStockMovement(employee, ITEM_DETERGENTE, { type: 'INCOME', quantity: '0.01' }, meta),
    ).rejects.toThrow(StockBalanceLimitError);
  });

  it('producto desactivado → 409 y sin movimiento', async () => {
    await expect(
      createStockMovement(admin, ITEM_PAPEL, { type: 'INCOME', quantity: '1' }, meta),
    ).rejects.toThrow(StockItemInactiveError);
    expect(getFakeStockPrisma().movements).toHaveLength(2);
  });

  it('producto inexistente → 404', async () => {
    await expect(
      createStockMovement(admin, ITEM_INEXISTENTE, { type: 'INCOME', quantity: '1' }, meta),
    ).rejects.toThrow(StockItemNotFoundError);
  });
});

describe('createStockMovement — destinos y fechas', () => {
  it('acepta un destino activo en un consumo y lo devuelve serializado', async () => {
    const { movement } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5', destinationId: DEST_OPERATIVO },
      meta,
    );
    expect(movement.destination).toEqual({
      id: DEST_OPERATIVO,
      name: 'Camioneta',
      type: 'VEHICLE',
    });
  });

  it('destino inexistente → 404; inactivo → 409', async () => {
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1', destinationId: DEST_INEXISTENTE },
        meta,
      ),
    ).rejects.toThrow(StockDestinationNotFoundError);
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1', destinationId: DEST_INACTIVO },
        meta,
      ),
    ).rejects.toThrow(StockDestinationInactiveError);
  });

  it('el servicio también rechaza un destino en ingresos o ajustes', async () => {
    await expect(
      createStockMovement(
        admin,
        ITEM_DETERGENTE,
        {
          type: 'INCOME',
          quantity: '1',
          destinationId: DEST_OPERATIVO,
        } as Parameters<typeof createStockMovement>[2],
        meta,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('sin fecha efectiva usa el día de negocio de hoy (zona de negocio, no UTC del proceso)', async () => {
    const { movement } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      meta,
      new Date('2026-09-15T12:00:00Z'), // 09:00 en Buenos Aires → 2026-09-15
    );
    expect(movement.effectiveDate).toBe('2026-09-15');
  });

  it('cerca de medianoche UTC pertenece al día local de negocio, no al UTC', async () => {
    const { movement } = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      meta,
      new Date('2026-09-15T02:00:00Z'), // 23:00 del 14 en Buenos Aires
    );
    expect(movement.effectiveDate).toBe('2026-09-14');
  });

  it('fecha explícita se respeta', async () => {
    const { movement } = await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1', effectiveDate: '2026-08-01' },
      meta,
    );
    expect(movement.effectiveDate).toBe('2026-08-01');
  });

  it('rechaza toda fecha futura, también para ADMIN', async () => {
    await expect(
      createStockMovement(
        admin,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1', effectiveDate: '2026-09-16' },
        meta,
        new Date('2026-09-15T12:00:00Z'),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  });

  it('EMPLOYEE solo registra hoy; la retroactividad queda limitada a ADMIN', async () => {
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1', effectiveDate: '2026-09-14' },
        meta,
        new Date('2026-09-15T12:00:00Z'),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'AUTH_FORBIDDEN' });
    const result = await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1', effectiveDate: '2026-09-14' },
      meta,
      new Date('2026-09-15T12:00:00Z'),
    );
    expect(result.movement.effectiveDate).toBe('2026-09-14');
  });

  it('fecha de calendario inexistente → 400', async () => {
    await expect(
      createStockMovement(
        admin,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1', effectiveDate: '2026-02-30' },
        meta,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

// ── Idempotencia (Etapa 5C.1) ─────────────────────────────────────────────

function expectCreated(result: CreateStockMovementResult) {
  if (result.kind !== 'created') {
    throw new Error(`Se esperaba kind=created y llegó ${result.kind}`);
  }
  return result;
}

describe('computeMovementRequestHash — huella canónica de la request', () => {
  const endpoint = `POST /stock/items/${ITEM_DETERGENTE}/movements`;
  const effectiveDate = '2026-09-24';

  it('la representación de la cantidad no cambia la huella (1 y 1.00 es el mismo request)', () => {
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        effectiveDate,
      ),
    ).toBe(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1.00' },
        effectiveDate,
      ),
    );
  });

  it('cualquier campo distinto del body o del endpoint lógico cambia la huella', () => {
    const base = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      effectiveDate,
    );
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '2' },
        effectiveDate,
      ),
    ).not.toBe(base);
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1' },
        effectiveDate,
      ),
    ).not.toBe(base);
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1', reason: 'Otro motivo' },
        effectiveDate,
      ),
    ).not.toBe(base);
    expect(
      computeMovementRequestHash(
        `POST /stock/items/${ITEM_FERTILIZANTE}/movements`,
        ITEM_FERTILIZANTE,
        { type: 'INCOME', quantity: '1' },
        effectiveDate,
      ),
    ).not.toBe(base);
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        '2026-09-25',
      ),
    ).not.toBe(base);
  });

  it('omitido y undefined son el mismo opcional; un valor real cambia la huella', () => {
    const omitted = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      effectiveDate,
    );
    const undefinedOptionals = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1', destinationId: undefined, reason: undefined },
      effectiveDate,
    );
    const withReason = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1', reason: 'Uso operativo' },
      effectiveDate,
    );
    expect(undefinedOptionals).toBe(omitted);
    expect(withReason).not.toBe(omitted);
  });

  it('los UUID se canonicalizan en minúsculas; el destino sigue siendo parte de la huella', () => {
    const DEST_HEX = 'abcdef12-3456-4abc-8def-abcdef123456';
    const lower = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1', destinationId: DEST_HEX },
      effectiveDate,
    );
    const upper = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1', destinationId: DEST_HEX.toUpperCase() },
      effectiveDate,
    );
    const withoutDestination = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      effectiveDate,
    );
    expect(upper).toBe(lower);
    expect(withoutDestination).not.toBe(lower);
  });

  it('decimales equivalentes producen la misma huella; distintos, otra', () => {
    const hash = (quantity: string) =>
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity },
        effectiveDate,
      );
    expect(hash('1.5')).toBe(hash('1.50'));
    expect(hash('0.5')).toBe(hash('0.50'));
    expect(hash('10')).toBe(hash('10.0'));
    expect(hash('1.5')).not.toBe(hash('1.05'));
    expect(hash('10')).not.toBe(hash('1'));
  });

  it('es un SHA-256 hex estable (sin aleatoriedad)', () => {
    const value = computeMovementRequestHash(
      endpoint,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      effectiveDate,
    );
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computeMovementRequestHash(
        endpoint,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        effectiveDate,
      ),
    ).toBe(value);
  });
});

describe('createStockMovement — Idempotency-Key', () => {
  const KEY = 'test-key-0001';

  it('clave con formato inválido → 400 controlado y sin escritura', async () => {
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date(),
        'corta',
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'IDEMPOTENCY_KEY_INVALID' });
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(2);
    expect(fake.idempotencyRecords).toHaveLength(0);
  });

  it('replay: misma clave y mismo body → UNA sola escritura y la respuesta almacenada', async () => {
    const first = expectCreated(
      await createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '0.5' },
        meta,
        new Date(),
        KEY,
      ),
    );
    const second = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    expect(second).toEqual({
      kind: 'replay',
      status: 201,
      body: { movement: first.movement, item: first.item },
    });
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(3); // 2 del seed + exactamente 1
    expect(
      fake.auditLogs.filter((entry) => entry.action === 'stock.movement.created'),
    ).toHaveLength(1);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('1.5'); // descontado una sola vez
    expect(fake.idempotencyRecords).toHaveLength(1);
    expect(fake.idempotencyRecords[0]?.responseStatus).toBe(201);
    expect(fake.idempotencyRecords[0]?.responseBody).toEqual({
      movement: first.movement,
      item: first.item,
    });
    expect(fake.idempotencyRecords[0]?.completedAt).not.toBeNull();
  });

  it('fecha omitida: reintenta el mismo día, pero la misma clave al día siguiente entra en conflicto', async () => {
    const firstDay = new Date('2026-09-24T15:00:00.000Z');
    const sameBusinessDay = new Date('2026-09-24T20:00:00.000Z');
    const nextBusinessDay = new Date('2026-09-25T15:00:00.000Z');
    await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      meta,
      firstDay,
      KEY,
    );
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        sameBusinessDay,
        KEY,
      ),
    ).resolves.toMatchObject({ kind: 'replay', status: 201 });
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        nextBusinessDay,
        KEY,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
    expect(getFakeStockPrisma().movements).toHaveLength(3);
  });

  it('misma clave con body distinto → 409 y sin nuevas escrituras', async () => {
    await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '1' },
        meta,
        new Date(),
        KEY,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' });
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(3);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('1.5');
    expect(fake.auditLogs).toHaveLength(1);
  });

  it('actores distintos con la misma clave no colisionan (la clave es por actor)', async () => {
    await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    await createStockMovement(
      admin,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(4);
    expect(fake.idempotencyRecords).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(2);
  });

  it('misma clave en endpoints distintos (otro producto) no colisiona', async () => {
    await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      meta,
      new Date(),
      KEY,
    );
    await createStockMovement(
      employee,
      ITEM_FERTILIZANTE,
      { type: 'INCOME', quantity: '1' },
      meta,
      new Date(),
      KEY,
    );
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(4);
    expect(fake.idempotencyRecords).toHaveLength(2);
  });

  it('si falla la escritura, la clave queda libre (sin registro incompleto) y el reintento funciona', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeStockMovementCreate = () => {
      throw new Error('fallo sintético de movimiento');
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date(),
        KEY,
      ),
    ).rejects.toThrow('fallo sintético de movimiento');
    fake.hooks.beforeStockMovementCreate = undefined;
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');

    const retry = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'INCOME', quantity: '1' },
      meta,
      new Date(),
      KEY,
    );
    expect(retry.kind).toBe('created');
    expect(fake.idempotencyRecords).toHaveLength(1);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('3');
  });

  it('si falla la auditoría se revierte también el registro idempotente', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeAuditLogCreate = () => {
      throw new Error('fallo sintético de auditoría');
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date(),
        KEY,
      ),
    ).rejects.toThrow('fallo sintético de auditoría');
    fake.hooks.beforeAuditLogCreate = undefined;
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
  });

  it('si falla completar status/body/completedAt, revierte movimiento, auditoría, saldo y reserva', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeIdempotencyRecordUpdate = () => {
      throw new Error('fallo sintético al completar idempotencia');
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ).rejects.toThrow('fallo sintético al completar idempotencia');
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(0);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
  });

  it('dos llamadas concurrentes con la misma clave crean UN solo movimiento', async () => {
    const [first, second] = await Promise.all([
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '0.5' },
        meta,
        new Date(),
        KEY,
      ),
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '0.5' },
        meta,
        new Date(),
        KEY,
      ),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['created', 'replay']);
    const fake = getFakeStockPrisma();
    expect(fake.movements).toHaveLength(3);
    expect(fake.idempotencyRecords).toHaveLength(1);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('1.5');
  });

  it('dos llamadas concurrentes con la misma clave y distinto body: una gana y la otra devuelve conflicto', async () => {
    const results = await Promise.allSettled([
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '2' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
    expect(getFakeStockPrisma().movements).toHaveLength(3);
    expect(getFakeStockPrisma().auditLogs).toHaveLength(1);
  });

  it('si el primer ganador revierte, el request concurrente puede reservar y ejecutar una sola vez', async () => {
    const fake = getFakeStockPrisma();
    let movementAttempts = 0;
    fake.hooks.beforeStockMovementCreate = () => {
      movementAttempts += 1;
      if (movementAttempts === 1) throw new Error('ganador sintético revertido');
    };
    const results = await Promise.allSettled([
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(fake.idempotencyRecords).toHaveLength(1);
    expect(fake.movements).toHaveLength(3);
    expect(fake.auditLogs).toHaveLength(1);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('3');
  });

  it('P2002 de la reserva sin registro visible devuelve pendiente y nunca reintenta la escritura', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeIdempotencyRecordCreate = () => {
      fakeP2002('idempotency_records_actor_user_id_endpoint_key_key', 'idempotency_records');
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_RECORD_PENDING' });
    expect(fake.movements).toHaveLength(2);
    expect(fake.idempotencyRecords).toHaveLength(0);
  });

  it('un P2002 ajeno a la reserva no se transforma en replay idempotente', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeStockMovementCreate = () => {
      fakeP2002('stock_movements_reference_key', 'stock_movements');
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
    expect(fake.items.get(ITEM_DETERGENTE)?.currentQuantity).toBe('2');
  });

  it('la forma legacy `meta.target` del P2002 de la reserva también resuelve a replay', async () => {
    const now = new Date('2026-09-24T15:00:00.000Z');
    const first = expectCreated(
      await createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        now,
        KEY,
      ),
    );
    const fake = getFakeStockPrisma();
    fake.hooks.beforeIdempotencyRecordCreate = () => {
      fakeLegacyP2002(['actor_user_id', 'endpoint', 'key']);
    };
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        now,
        KEY,
      ),
    ).resolves.toEqual({
      kind: 'replay',
      status: 201,
      body: { movement: first.movement, item: first.item },
    });
    expect(fake.movements).toHaveLength(3);
    expect(fake.auditLogs).toHaveLength(1);
  });

  it('un P2002 sin identidad de restricción se propaga: nunca se asume replay', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeIdempotencyRecordCreate = fakeAnonymousP2002;
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('el UUID del producto con otra capitalización es el mismo endpoint lógico (sin segunda escritura)', async () => {
    const ITEM_HEX = 'abcdef12-3456-4abc-8def-abcdef123456';
    const base = seed();
    resetFakeStockPrisma({
      ...base,
      items: [
        ...base.items,
        {
          id: ITEM_HEX,
          name: 'Producto sintético hex',
          area: 'HOUSE' as const,
          categoryId: CAT_HOUSE,
          unit: 'unidad',
          minimumQuantity: '1',
          currentQuantity: '5',
          active: true,
        },
      ],
    });
    const now = new Date('2026-09-24T15:00:00.000Z');
    const first = expectCreated(
      await createStockMovement(
        employee,
        ITEM_HEX,
        { type: 'INCOME', quantity: '1' },
        meta,
        now,
        KEY,
      ),
    );
    const second = await createStockMovement(
      employee,
      ITEM_HEX.toUpperCase(),
      { type: 'INCOME', quantity: '1.00' },
      meta,
      now,
      KEY,
    );
    expect(second).toEqual({
      kind: 'replay',
      status: 201,
      body: { movement: first.movement, item: first.item },
    });
    const fake = getFakeStockPrisma();
    expect(fake.idempotencyRecords).toHaveLength(1);
    expect(fake.idempotencyRecords[0]?.endpoint).toBe(`POST /stock/items/${ITEM_HEX}/movements`);
    expect(fake.items.get(ITEM_HEX)?.currentQuantity).toBe('6');
    expect(fake.movements.filter((movement) => movement.type === 'INCOME')).toHaveLength(1);
  });

  it('el timeout transaccional queda acotado y se expone como pendiente reintentable', async () => {
    const fake = getFakeStockPrisma();
    fake.hooks.beforeIdempotencyRecordCreate = fakeP2028;
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'INCOME', quantity: '1' },
        meta,
        new Date('2026-09-24T15:00:00.000Z'),
        KEY,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_RECORD_PENDING' });
    expect(fake.idempotencyRecords).toHaveLength(0);
    expect(fake.movements).toHaveLength(2);
  });

  it('un registro pendiente (estado inesperado) → 409 controlado, sin re-ejecutar', async () => {
    const fake = getFakeStockPrisma();
    fake.idempotencyRecords.push({
      id: crypto.randomUUID(),
      actorUserId: USER_EMPLOYEE,
      endpoint: `POST /stock/items/${ITEM_DETERGENTE}/movements`,
      key: KEY,
      requestHash: 'x'.repeat(64),
      responseStatus: null,
      responseBody: null,
      completedAt: null,
      createdAt: new Date(),
    });
    await expect(
      createStockMovement(
        employee,
        ITEM_DETERGENTE,
        { type: 'CONSUMPTION', quantity: '0.5' },
        meta,
        new Date(),
        KEY,
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_RECORD_PENDING' });
    expect(fake.movements).toHaveLength(2);
    expect(fake.auditLogs).toHaveLength(0);
  });

  it('sin clave no se crean registros (camino idéntico a la Etapa 5A)', async () => {
    const result = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
    );
    expect(result.kind).toBe('created');
    expect(getFakeStockPrisma().idempotencyRecords).toHaveLength(0);
  });

  it('ni la respuesta creada ni el replay exponen la huella de la request', async () => {
    const first = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    const second = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '0.5' },
      meta,
      new Date(),
      KEY,
    );
    expect(JSON.stringify(first)).not.toMatch(/requestHash|hash/i);
    expect(JSON.stringify(second)).not.toMatch(/requestHash|hash/i);
  });
});

describe('inmutabilidad del histórico de movimientos', () => {
  it('el modelo fake no expone update/delete/updateMany de StockMovement', () => {
    const fake = getFakeStockPrisma();
    expect((fake.api.stockMovement as Record<string, unknown>).update).toBeUndefined();
    expect((fake.api.stockMovement as Record<string, unknown>).delete).toBeUndefined();
    expect((fake.api.stockMovement as Record<string, unknown>).updateMany).toBeUndefined();
    expect((fake.api.stockMovement as Record<string, unknown>).deleteMany).toBeUndefined();
  });

  it('los DTO no exponen hashes, tokens, usuarios internos ni campos Prisma completos', async () => {
    const result = await createStockMovement(
      employee,
      ITEM_DETERGENTE,
      { type: 'CONSUMPTION', quantity: '1' },
      meta,
    );
    expect(JSON.stringify(result)).not.toMatch(/pin|hash|token|recordedByUser|updatedAt/i);
  });
});
