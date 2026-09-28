import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

/**
 * Política de eliminación definitiva (Prisma simulado): solo ADMIN, 404 si no
 * existe, 409 `*_IN_USE` con cualquier historia (se cuenta TODO, incluido lo
 * revertido/anulado/eliminado lógicamente), auditoría con snapshot ANTES del
 * borrado, borrado condicionado (DELETE concurrente → 404), clave foránea
 * rota en paralelo → 409, y nunca se borran dependencias. La SQL real y la
 * concurrencia real se prueban contra `demo` en `deletion.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), count: vi.fn(), deleteMany: vi.fn() });
  return {
    task: model(),
    taskExecution: model(),
    taskPlanningInterval: model(),
    fileAsset: model(),
    stockCategory: model(),
    stockItem: model(),
    stockMovement: model(),
    consumptionDestination: model(),
    animalType: model(),
    animal: model(),
    animalMedicalRecord: model(),
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { deleteTask } from '../../tasks/tasksService';
import {
  deleteStockCategory,
  deleteStockDestination,
  deleteStockItem,
} from '../../stock/stockService';
import { deletePet, deletePetType } from '../../pets/petService';

const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const EMPLOYEE = { userId: 'u-emp', role: 'EMPLOYEE' as const, employeeId: 'e-1' };
const META = { ipAddress: '127.0.0.1', userAgent: 'test' };
const ID = '11111111-1111-4111-8111-111111111111';

const fkViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', {
    code: 'P2003',
    clientVersion: 'test',
  });

interface Case {
  name: string;
  run: (actor: typeof ADMIN | typeof EMPLOYEE) => Promise<void>;
  /** Modelo principal que se borra. */
  main: keyof typeof db;
  row: Record<string, unknown>;
  /** Dependencias que se cuentan (en orden) y que nunca se borran. */
  deps: (keyof typeof db)[];
  notFound: string;
  inUse: string;
  action: string;
}

const CASES: Case[] = [
  {
    name: 'Tarea',
    run: (actor) => deleteTask(actor, ID, META),
    main: 'task',
    row: { description: 'Tarea sintética', employeeId: 'e-1', frequency: 'DAILY', active: true },
    deps: ['taskExecution', 'fileAsset'],
    notFound: 'TASK_NOT_FOUND',
    inUse: 'TASK_IN_USE',
    action: 'task.deleted',
  },
  {
    name: 'Categoría de stock',
    run: (actor) => deleteStockCategory(actor, ID, META),
    main: 'stockCategory',
    row: { name: 'Categoría sintética', area: 'HOUSE', active: false },
    deps: ['stockItem'],
    notFound: 'STOCK_CATEGORY_NOT_FOUND',
    inUse: 'STOCK_CATEGORY_IN_USE',
    action: 'stock.category.deleted',
  },
  {
    name: 'Producto de stock',
    run: (actor) => deleteStockItem(actor, ID, META),
    main: 'stockItem',
    row: {
      name: 'Producto sintético',
      area: 'HOUSE',
      categoryId: 'c-1',
      unit: 'u',
      minimumQuantity: new Prisma.Decimal('1'),
      currentQuantity: new Prisma.Decimal('0'),
      active: true,
    },
    deps: ['stockMovement'],
    notFound: 'STOCK_ITEM_NOT_FOUND',
    inUse: 'STOCK_ITEM_IN_USE',
    action: 'stock.item.deleted',
  },
  {
    name: 'Destino de stock',
    run: (actor) => deleteStockDestination(actor, ID, META),
    main: 'consumptionDestination',
    row: { name: 'Destino sintético', type: 'VEHICLE', active: true },
    deps: ['stockMovement'],
    notFound: 'STOCK_DESTINATION_NOT_FOUND',
    inUse: 'STOCK_DESTINATION_IN_USE',
    action: 'stock.destination.deleted',
  },
  {
    name: 'Tipo de mascota agregado',
    run: (actor) => deletePetType(actor, ID, META),
    main: 'animalType',
    row: { id: ID, name: 'Ternero sintético', icon: '🐂', active: false },
    deps: ['animal'],
    notFound: 'PET_TYPE_NOT_FOUND',
    inUse: 'PET_TYPE_IN_USE',
    action: 'pet.type.deleted',
  },
  {
    name: 'Mascota',
    run: (actor) => deletePet(actor, ID, META),
    main: 'animal',
    row: {
      name: 'Mascota sintética',
      animalTypeId: 't-1',
      breed: null,
      birthDate: null,
      active: false,
    },
    deps: ['animalMedicalRecord', 'fileAsset'],
    notFound: 'PET_NOT_FOUND',
    inUse: 'ANIMAL_IN_USE',
    action: 'pet.deleted',
  },
];

const model = (key: keyof typeof db) =>
  db[key] as {
    findUnique: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  db.auditLog.create.mockResolvedValue({});
  for (const key of Object.keys(db) as (keyof typeof db)[]) {
    const m = db[key] as {
      count?: ReturnType<typeof vi.fn>;
      deleteMany?: ReturnType<typeof vi.fn>;
    };
    m.count?.mockResolvedValue(0);
    m.deleteMany?.mockResolvedValue({ count: 1 });
  }
});

describe.each(CASES)('DELETE $name', (c) => {
  it('ADMIN elimina lo que no tiene historia: audita el snapshot ANTES de borrar', async () => {
    model(c.main).findUnique.mockResolvedValue(c.row);
    await c.run(ADMIN);
    const audit = db.auditLog.create.mock.calls[0]?.[0].data;
    expect(audit).toMatchObject({ action: c.action, entityId: ID, actorUserId: 'u-admin' });
    expect(audit.previousState).toBeTruthy();
    expect(JSON.stringify(audit.previousState)).not.toMatch(/pin|hash|token|secret/i);
    const deleted = model(c.main).deleteMany;
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      deleted.mock.invocationCallOrder[0]!,
    );
    // Nunca se borran dependencias (solo los intervalos técnicos de una tarea sin uso).
    for (const dep of c.deps) expect(model(dep).deleteMany).not.toHaveBeenCalled();
  });

  it('EMPLOYEE recibe 403 y no se abre ninguna transacción', async () => {
    await expect(c.run(EMPLOYEE)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('inexistente → 404 y nada se audita', async () => {
    model(c.main).findUnique.mockResolvedValue(null);
    await expect(c.run(ADMIN)).rejects.toMatchObject({ statusCode: 404, code: c.notFound });
    expect(db.auditLog.create).not.toHaveBeenCalled();
    expect(model(c.main).deleteMany).not.toHaveBeenCalled();
  });

  it.each([0, 1].slice(0, c.deps.length))(
    'con historia (dependencia %i) → 409 *_IN_USE, sin borrar ni auditar',
    async (index) => {
      model(c.main).findUnique.mockResolvedValue(c.row);
      model(c.deps[index]!).count.mockResolvedValue(1);
      await expect(c.run(ADMIN)).rejects.toMatchObject({ statusCode: 409, code: c.inUse });
      expect(model(c.main).deleteMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    },
  );

  it('DELETE simultáneo: el segundo ve 0 filas y responde 404 (la transacción se revierte)', async () => {
    model(c.main).findUnique.mockResolvedValue(c.row);
    model(c.main).deleteMany.mockResolvedValue({ count: 0 });
    // Tras un borrado ajeno, la fila ya no existe.
    model(c.main).count.mockResolvedValue(0);
    await expect(c.run(ADMIN)).rejects.toMatchObject({ statusCode: 404, code: c.notFound });
  });

  it('una dependencia agregada en paralelo (FK) → 409 controlado, nunca 500', async () => {
    model(c.main).findUnique.mockResolvedValue(c.row);
    model(c.main).deleteMany.mockRejectedValue(fkViolation());
    await expect(c.run(ADMIN)).rejects.toMatchObject({ statusCode: 409, code: c.inUse });
  });
});

describe('reglas específicas', () => {
  it('Tarea: la ejecución REVERTIDA también cuenta (se cuenta sin filtro de revertedAt)', async () => {
    model('task').findUnique.mockResolvedValue(CASES[0]!.row);
    model('taskExecution').count.mockResolvedValue(1);
    await expect(deleteTask(ADMIN, ID, META)).rejects.toMatchObject({ code: 'TASK_IN_USE' });
    expect(model('taskExecution').count).toHaveBeenCalledWith({ where: { taskId: ID } });
  });

  it('Tarea sin uso: borra sus intervalos técnicos y luego la tarea', async () => {
    model('task').findUnique.mockResolvedValue(CASES[0]!.row);
    await deleteTask(ADMIN, ID, META);
    expect(model('taskPlanningInterval').deleteMany).toHaveBeenCalledWith({
      where: { taskId: ID },
    });
    expect(model('taskPlanningInterval').deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      model('task').deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it('Producto: con OPENING_BALANCE (cualquier movimiento) no se elimina', async () => {
    model('stockItem').findUnique.mockResolvedValue(CASES[2]!.row);
    model('stockMovement').count.mockResolvedValue(1);
    await expect(deleteStockItem(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'STOCK_ITEM_IN_USE',
    });
    expect(model('stockMovement').count).toHaveBeenCalledWith({ where: { stockItemId: ID } });
  });

  it('Producto: saldo distinto de 0 → 409; el borrado vuelve a exigir saldo 0 en la misma sentencia', async () => {
    model('stockItem').findUnique.mockResolvedValue({
      ...CASES[2]!.row,
      currentQuantity: new Prisma.Decimal('0.5'),
    });
    await expect(deleteStockItem(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'STOCK_ITEM_IN_USE',
    });
    model('stockItem').findUnique.mockResolvedValue(CASES[2]!.row);
    await deleteStockItem(ADMIN, ID, META);
    expect(model('stockItem').deleteMany).toHaveBeenCalledWith({
      where: { id: ID, currentQuantity: 0 },
    });
    // Si en paralelo entró saldo, el borrado condicionado no afecta filas y sigue existiendo → 409.
    model('stockItem').deleteMany.mockResolvedValue({ count: 0 });
    model('stockItem').count.mockResolvedValue(1);
    await expect(deleteStockItem(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'STOCK_ITEM_IN_USE',
    });
  });

  it('Destino usado históricamente (aunque esté inactivo) no se elimina', async () => {
    model('consumptionDestination').findUnique.mockResolvedValue({
      ...CASES[3]!.row,
      active: false,
    });
    model('stockMovement').count.mockResolvedValue(3);
    await expect(deleteStockDestination(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'STOCK_DESTINATION_IN_USE',
    });
    expect(model('stockMovement').count).toHaveBeenCalledWith({ where: { destinationId: ID } });
  });

  it('Mascota: un registro ANULADO y un archivo eliminado lógicamente también son historia', async () => {
    model('animal').findUnique.mockResolvedValue(CASES[5]!.row);
    model('animalMedicalRecord').count.mockResolvedValue(1);
    await expect(deletePet(ADMIN, ID, META)).rejects.toMatchObject({ code: 'ANIMAL_IN_USE' });
    // Sin filtros de estado: cuenta todo.
    expect(model('animalMedicalRecord').count).toHaveBeenCalledWith({ where: { animalId: ID } });
    model('animalMedicalRecord').count.mockResolvedValue(0);
    model('fileAsset').count.mockResolvedValue(1);
    await expect(deletePet(ADMIN, ID, META)).rejects.toMatchObject({ code: 'ANIMAL_IN_USE' });
    expect(model('fileAsset').count).toHaveBeenLastCalledWith({ where: { animalId: ID } });
  });

  it('Tipo precargado nunca se elimina; uno agregado con mascotas (aun inactivas) tampoco', async () => {
    model('animalType').findUnique.mockResolvedValue({
      id: ID,
      name: 'Perro',
      icon: '🐕',
      active: true,
    });
    await expect(deletePetType(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'PET_TYPE_BUILTIN',
    });
    model('animalType').findUnique.mockResolvedValue(CASES[4]!.row);
    model('animal').count.mockResolvedValue(2);
    await expect(deletePetType(ADMIN, ID, META)).rejects.toMatchObject({ code: 'PET_TYPE_IN_USE' });
    expect(model('animal').count).toHaveBeenCalledWith({ where: { animalTypeId: ID } });
    expect(model('animal').deleteMany).not.toHaveBeenCalled();
  });
});
