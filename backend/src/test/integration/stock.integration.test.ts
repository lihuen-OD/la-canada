import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../lib/prisma';
import { createStockMovement, type StockActor } from '../../stock/stockService';

const RUN = `test-stock-${Date.now()}`;
const META = { ipAddress: null, userAgent: 'vitest-integration' };
const createdItemIds: string[] = [];
let categoryId = '';
let employeeId = '';
let userId = '';
let actor: StockActor;
let baseline: {
  categories: number;
  items: number;
  movements: number;
  audits: number;
  users: number;
  employees: number;
};

async function createItem(suffix: string, quantity: string) {
  const item = await prisma.stockItem.create({
    data: {
      name: `${RUN}-${suffix}`,
      area: 'HOUSE',
      categoryId,
      unit: 'unidades',
      minimumQuantity: new Prisma.Decimal('1'),
      currentQuantity: new Prisma.Decimal(quantity),
    },
    select: { id: true },
  });
  createdItemIds.push(item.id);
  return item.id;
}

beforeAll(async () => {
  const [categories, items, movements, audits, users, employees] = await Promise.all([
    prisma.stockCategory.count(),
    prisma.stockItem.count(),
    prisma.stockMovement.count(),
    prisma.auditLog.count(),
    prisma.user.count(),
    prisma.employee.count(),
  ]);
  baseline = { categories, items, movements, audits, users, employees };
  const category = await prisma.stockCategory.create({
    data: { name: RUN, area: 'HOUSE' },
    select: { id: true },
  });
  categoryId = category.id;
  const employee = await prisma.employee.create({
    data: { code: RUN, displayName: `Sintético ${RUN}`, role: 'Test', colorHex: '#466547' },
    select: { id: true },
  });
  employeeId = employee.id;
  const user = await prisma.user.create({
    data: {
      username: RUN,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  userId = user.id;
  actor = { userId, role: 'EMPLOYEE', employeeId };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
  await prisma.stockMovement.deleteMany({ where: { stockItemId: { in: createdItemIds } } });
  await prisma.stockItem.deleteMany({ where: { id: { in: createdItemIds } } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  if (employeeId) await prisma.employee.delete({ where: { id: employeeId } });
  if (categoryId) await prisma.stockCategory.delete({ where: { id: categoryId } });

  expect(await prisma.stockCategory.count()).toBe(baseline.categories);
  expect(await prisma.stockItem.count()).toBe(baseline.items);
  expect(await prisma.stockMovement.count()).toBe(baseline.movements);
  expect(await prisma.auditLog.count()).toBe(baseline.audits);
  expect(await prisma.user.count()).toBe(baseline.users);
  expect(await prisma.employee.count()).toBe(baseline.employees);
});

describe('Stock 5A — transacciones reales contra demo', () => {
  it('dos consumos concurrentes nunca dejan saldo negativo', async () => {
    const itemId = await createItem('consumos', '10');
    const results = await Promise.allSettled([
      createStockMovement(actor, itemId, { type: 'CONSUMPTION', quantity: '7' }, META),
      createStockMovement(actor, itemId, { type: 'CONSUMPTION', quantity: '7' }, META),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('3');
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(1);
  });

  it('dos ingresos concurrentes conservan ambos incrementos', async () => {
    const itemId = await createItem('ingresos', '0');
    await Promise.all([
      createStockMovement(actor, itemId, { type: 'INCOME', quantity: '1.25' }, META),
      createStockMovement(actor, itemId, { type: 'INCOME', quantity: '2.50' }, META),
    ]);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('3.75');
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(2);
  });

  it('revierte el saldo si falla la creación del movimiento', async () => {
    const itemId = await createItem('rollback-movement', '5');
    const invalidActor: StockActor = {
      userId,
      role: 'EMPLOYEE',
      employeeId: '11111111-1111-4111-8111-111111111111',
    };
    await expect(
      createStockMovement(invalidActor, itemId, { type: 'INCOME', quantity: '2' }, META),
    ).rejects.toBeDefined();
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('5');
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(0);
  });

  it('revierte saldo y movimiento si falla la auditoría', async () => {
    const itemId = await createItem('rollback-audit', '5');
    const invalidActor: StockActor = {
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'EMPLOYEE',
      employeeId,
    };
    await expect(
      createStockMovement(invalidActor, itemId, { type: 'INCOME', quantity: '2' }, META),
    ).rejects.toBeDefined();
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('5');
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(0);
  });
});
