import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { TaskInUseError } from '../../errors/AppError';
import { isForeignKeyViolation, runEntityDeletion } from '../../lib/deletion';
import { prisma } from '../../lib/prisma';

/**
 * Eliminación definitiva contra PostgreSQL real (`demo`): 204/403/404/409
 * por HTTP, auditoría con snapshot, dependencias intactas, dos DELETE
 * simultáneos (204 + 404, nunca 500) y la forma real de la violación de
 * clave foránea con `adapter-pg`. Fixtures `test-del-<RUN>`, limpieza por IDs
 * propios; no se toca ninguna fila real.
 */
const RUN = `test-del-${Date.now()}`;
let app: Express;
let adminToken = '';
let employeeToken = '';
const ids = {
  users: [] as string[],
  employees: [] as string[],
  tasks: [] as string[],
  categories: [] as string[],
  items: [] as string[],
  destinations: [] as string[],
  types: [] as string[],
  pets: [] as string[],
};

async function actor(role: 'ADMIN' | 'EMPLOYEE', employeeId?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${role.toLowerCase()}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  ids.users.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    select: { id: true },
  });
  return signAccessToken({ userId: user.id, sessionId: session.id, role }, accessTokenSecret, 3600);
}

const del = (path: string, token = adminToken) =>
  request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);

async function newTask(name: string) {
  const task = await prisma.task.create({
    data: { description: `${RUN} ${name}`, employeeId: ids.employees[0]!, frequency: 'URGENT' },
    select: { id: true },
  });
  ids.tasks.push(task.id);
  await prisma.taskPlanningInterval.create({
    data: {
      taskId: task.id,
      employeeId: ids.employees[0]!,
      frequency: 'URGENT',
      validFrom: new Date(),
    },
  });
  return task.id;
}

async function newCategory(name: string) {
  const row = await prisma.stockCategory.create({
    data: { name: `${RUN} ${name}`, area: 'HOUSE' },
    select: { id: true },
  });
  ids.categories.push(row.id);
  return row.id;
}

async function newItem(name: string, categoryId: string) {
  const row = await prisma.stockItem.create({
    data: {
      name: `${RUN} ${name}`,
      area: 'HOUSE',
      categoryId,
      unit: 'u',
      minimumQuantity: '1',
    },
    select: { id: true },
  });
  ids.items.push(row.id);
  return row.id;
}

async function newDestination(name: string) {
  const row = await prisma.consumptionDestination.create({
    data: { name: `${RUN} ${name}`, type: 'SECTOR' },
    select: { id: true },
  });
  ids.destinations.push(row.id);
  return row.id;
}

async function newType(name: string) {
  const row = await prisma.animalType.create({
    data: { name: `${RUN} ${name}` },
    select: { id: true },
  });
  ids.types.push(row.id);
  return row.id;
}

async function newPet(name: string, typeId: string) {
  const row = await prisma.animal.create({
    data: { name: `${RUN} ${name}`, animalTypeId: typeId },
    select: { id: true },
  });
  ids.pets.push(row.id);
  return row.id;
}

beforeAll(async () => {
  expect(process.env.DATABASE_TARGET).toBe('demo');
  app = createApp();
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-employee`,
      displayName: `Sintético ${RUN}`,
      role: 'Otro',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  ids.employees.push(employee.id);
  adminToken = await actor('ADMIN');
  employeeToken = await actor('EMPLOYEE', employee.id);
}, 60_000);

afterAll(async () => {
  await prisma.stockMovement.deleteMany({ where: { stockItemId: { in: ids.items } } });
  await prisma.taskExecution.deleteMany({ where: { taskId: { in: ids.tasks } } });
  await prisma.taskPlanningInterval.deleteMany({ where: { taskId: { in: ids.tasks } } });
  await prisma.task.deleteMany({ where: { id: { in: ids.tasks } } });
  await prisma.stockItem.deleteMany({ where: { id: { in: ids.items } } });
  await prisma.stockCategory.deleteMany({ where: { id: { in: ids.categories } } });
  await prisma.consumptionDestination.deleteMany({ where: { id: { in: ids.destinations } } });
  await prisma.animalMedicalRecord.deleteMany({ where: { animalId: { in: ids.pets } } });
  await prisma.animal.deleteMany({ where: { id: { in: ids.pets } } });
  await prisma.animalType.deleteMany({ where: { id: { in: ids.types } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids.users } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids.users } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.employee.deleteMany({ where: { id: { in: ids.employees } } });
  const residue = await Promise.all([
    prisma.task.count({ where: { description: { startsWith: RUN } } }),
    prisma.stockCategory.count({ where: { name: { startsWith: RUN } } }),
    prisma.stockItem.count({ where: { name: { startsWith: RUN } } }),
    prisma.consumptionDestination.count({ where: { name: { startsWith: RUN } } }),
    prisma.animalType.count({ where: { name: { startsWith: RUN } } }),
    prisma.animal.count({ where: { name: { startsWith: RUN } } }),
    prisma.user.count({ where: { username: { startsWith: RUN } } }),
    prisma.employee.count({ where: { code: { startsWith: RUN } } }),
  ]);
  expect(residue).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
}, 60_000);

describe('DELETE contra demo', () => {
  it('Tarea sin uso: 204, se van sus intervalos técnicos y queda la auditoría con snapshot', async () => {
    const id = await newTask('sin uso');
    expect((await del(`/tasks/${id}`, employeeToken)).status).toBe(403);
    expect((await del(`/tasks/${id}`)).status).toBe(204);
    expect(await prisma.task.count({ where: { id } })).toBe(0);
    expect(await prisma.taskPlanningInterval.count({ where: { taskId: id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'task.deleted' },
      select: { previousState: true },
    });
    expect(audit?.previousState).toMatchObject({ description: `${RUN} sin uso` });
    expect((await del(`/tasks/${id}`)).status).toBe(404);
  });

  it('Tarea con una ejecución REVERTIDA: 409 TASK_IN_USE y la ejecución sigue intacta', async () => {
    const id = await newTask('revertida');
    const adminUser = ids.users[0]!;
    await prisma.taskExecution.create({
      data: {
        taskId: id,
        periodKey: 'URGENT',
        completed: false,
        completedAt: new Date(),
        assignedEmployeeId: ids.employees[0]!,
        completedByEmployeeId: ids.employees[0]!,
        revertedAt: new Date(),
        revertedByUserId: adminUser,
        revertReason: 'test',
      },
    });
    const response = await del(`/tasks/${id}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('TASK_IN_USE');
    expect(response.body.error.message).toBe(
      'No se puede eliminar esta tarea porque tiene actividad registrada. Podés desactivarla para conservar su historial.',
    );
    expect(await prisma.taskExecution.count({ where: { taskId: id } })).toBe(1);
  });

  it('dos DELETE simultáneos: uno 204 y otro 404, nunca 500', async () => {
    const id = await newTask('concurrente');
    const statuses = (await Promise.all([del(`/tasks/${id}`), del(`/tasks/${id}`)])).map(
      (r) => r.status,
    );
    expect(statuses.sort()).toEqual([204, 404]);
  });

  it('dependencia creada entre el conteo y el DELETE: la FK real se traduce al MISMO TASK_IN_USE', async () => {
    const id = await newTask('fk');
    await prisma.taskExecution.create({
      data: {
        taskId: id,
        periodKey: 'URGENT',
        completed: true,
        completedAt: new Date(),
        assignedEmployeeId: ids.employees[0]!,
        completedByEmployeeId: ids.employees[0]!,
      },
    });
    // Simula la carrera: el conteo "no vio" la ejecución (entró después) y el borrado choca con la FK real.
    const error = await prisma.task.delete({ where: { id } }).catch((e: unknown) => e);
    expect(isForeignKeyViolation(error)).toBe(true);
    await expect(
      runEntityDeletion(
        async (tx) => {
          await tx.taskPlanningInterval.deleteMany({ where: { taskId: id } });
          await tx.task.deleteMany({ where: { id } });
        },
        () => new TaskInUseError(),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'TASK_IN_USE' });
    // La transacción se revirtió: la tarea y su planificación siguen intactas.
    expect(await prisma.task.count({ where: { id } })).toBe(1);
    expect(await prisma.taskPlanningInterval.count({ where: { taskId: id } })).toBe(1);
  });

  it('Stock: categoría con productos (aun inactivos) 409; producto con OPENING_BALANCE 409; destino usado 409; sin uso 204', async () => {
    const category = await newCategory('con producto');
    const item = await newItem('con apertura', category);
    await prisma.stockItem.update({ where: { id: item }, data: { active: false } });
    let r = await del(`/stock/categories/${category}`);
    expect([r.status, r.body.error.code]).toEqual([409, 'STOCK_CATEGORY_IN_USE']);

    const destination = await newDestination('usado');
    await prisma.stockMovement.create({
      data: {
        stockItemId: item,
        type: 'OPENING_BALANCE',
        quantity: '1',
        effectiveDate: new Date('2026-09-01T00:00:00Z'),
        destinationId: destination,
      },
    });
    r = await del(`/stock/items/${item}`);
    expect([r.status, r.body.error.code]).toEqual([409, 'STOCK_ITEM_IN_USE']);
    r = await del(`/stock/destinations/${destination}`);
    expect([r.status, r.body.error.code]).toEqual([409, 'STOCK_DESTINATION_IN_USE']);
    expect(await prisma.stockMovement.count({ where: { stockItemId: item } })).toBe(1);

    const emptyCategory = await newCategory('vacía');
    const unusedItem = await newItem('sin movimientos', emptyCategory);
    const unusedDestination = await newDestination('sin uso');
    expect((await del(`/stock/items/${unusedItem}`, employeeToken)).status).toBe(403);
    expect((await del(`/stock/items/${unusedItem}`)).status).toBe(204);
    expect((await del(`/stock/categories/${emptyCategory}`)).status).toBe(204);
    expect((await del(`/stock/destinations/${unusedDestination}`)).status).toBe(204);
    expect((await del(`/stock/destinations/${unusedDestination}`)).status).toBe(404);
  });

  it('Mascotas: con registro ANULADO 409; tipo agregado usado 409; precargado nunca; sin uso 204', async () => {
    const type = await newType('Tipo');
    const pet = await newPet('con anulado', type);
    await prisma.animalMedicalRecord.create({
      data: {
        animalId: pet,
        type: 'VACCINE',
        recordDate: new Date('2026-09-01T00:00:00Z'),
        voidedAt: new Date(),
        voidedByUserId: ids.users[0]!,
      },
    });
    let r = await del(`/pets/${pet}`);
    expect([r.status, r.body.error.code]).toEqual([409, 'ANIMAL_IN_USE']);
    r = await del(`/pets/types/${type}`);
    expect([r.status, r.body.error.code]).toEqual([409, 'PET_TYPE_IN_USE']);
    expect(await prisma.animal.count({ where: { id: pet } })).toBe(1);

    const builtin = await prisma.animalType.findFirst({
      where: { name: 'Perro' },
      select: { id: true },
    });
    if (builtin) {
      r = await del(`/pets/types/${builtin.id}`);
      expect([r.status, r.body.error.code]).toEqual([409, 'PET_TYPE_BUILTIN']);
    }

    const freshType = await newType('Tipo libre');
    const freshPet = await newPet('sin historia', freshType);
    expect((await del(`/pets/${freshPet}`, employeeToken)).status).toBe(403);
    expect((await del(`/pets/${freshPet}`)).status).toBe(204);
    expect((await del(`/pets/types/${freshType}`)).status).toBe(204);
  });
});
