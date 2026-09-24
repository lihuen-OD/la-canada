import { beforeEach, describe, expect, it, vi } from 'vitest';
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
} from '../../errors/AppError';
import {
  createStockCategory,
  createStockItem,
  createStockMovement,
  getStockItem,
  listStockCategories,
  listStockDestinations,
  listStockItems,
  listStockMovements,
  setStockItemActive,
  updateStockCategory,
  updateStockItem,
  type RequestMeta,
  type StockActor,
} from '../../stock/stockService';
import { getFakeStockPrisma, resetFakeStockPrisma } from './fakeStockPrisma';

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

  it('lista solo destinos activos', async () => {
    const { destinations } = await listStockDestinations();
    expect(destinations).toEqual([{ id: DEST_OPERATIVO, name: 'Camioneta', type: 'VEHICLE' }]);
  });

  it('detalle de producto inexistente → 404', async () => {
    await expect(getStockItem(ITEM_INEXISTENTE)).rejects.toMatchObject({
      statusCode: 404,
      code: 'STOCK_ITEM_NOT_FOUND',
    });
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
