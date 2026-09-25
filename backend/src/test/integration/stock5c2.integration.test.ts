import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { Prisma } from '../../generated/prisma/client';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Stock 5C.2 — reportes (`/stock/reports/*`), `sort=name` de Compras y el
 * flujo de movimiento idempotente que usa el frontend, contra Neon real
 * (`demo`) por HTTP real. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-5c2-<RUN>`; los reportes se
 *    filtran SIEMPRE por la categoría sintética, así nunca se leen ni se
 *    afirman cifras sobre datos reales;
 *  - nunca se mueve saldo ni se edita ninguna fila preexistente;
 *  - `afterAll` borra solo lo creado (por id) y verifica 0 residuos y
 *    conteos globales idénticos a los iniciales.
 * Las sentencias SQL por endpoint se cuentan instrumentando
 * `pg.Client.prototype.query` (solo verbo + tablas, nunca valores).
 */

const RUN = `test-5c2-${Date.now()}`;
const TZ = config.businessTimeZone;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let employeeId = '';
let categoryId = '';
let destinationId = '';
let itemKg = '';
let itemLiters = '';
let itemInactive = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
const itemIds: string[] = [];
let baseline: Record<string, number>;

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
const statements: string[] = [];
let counting = false;

function summarize(arg: unknown): string {
  const text = typeof arg === 'string' ? arg : ((arg as { text?: string })?.text ?? '');
  const verb = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '?';
  const tables = [...text.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+"?(?:public"?\."?)?"?(\w+)"?/gi)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index);
  return `${verb} ${tables.join(',')}`;
}

/** Sentencias de datos (sin BEGIN/COMMIT) que ejecutó `run`, incluida la de `requireAuth`. */
async function countStatements<T>(run: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  statements.length = 0;
  counting = true;
  try {
    const result = await run();
    return { result, sql: statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) };
  } finally {
    counting = false;
  }
}

async function globalCounts() {
  return {
    categories: await prisma.stockCategory.count(),
    items: await prisma.stockItem.count(),
    movements: await prisma.stockMovement.count(),
    destinations: await prisma.consumptionDestination.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, linked?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId: linked,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const token = await signAccessToken(
    { userId: user.id, sessionId: session.id, role },
    accessTokenSecret,
    3600,
  );
  return { userId: user.id, token };
}

async function createItem(suffix: string, unit: string, current: string, minimum: string) {
  const item = await prisma.stockItem.create({
    data: {
      name: `${RUN}-${suffix}`,
      area: 'HOUSE',
      categoryId,
      unit,
      minimumQuantity: new Prisma.Decimal(minimum),
      currentQuantity: new Prisma.Decimal(current),
    },
    select: { id: true },
  });
  itemIds.push(item.id);
  return item.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const today = () => formatLocalDate(toLocalDate(new Date(), TZ));

function postMovement(actor: Actor, itemId: string, body: object, key: string) {
  return request(app)
    .post(`/api/v1/stock/items/${itemId}/movements`)
    .set(as(actor))
    .set('Idempotency-Key', key)
    .send(body);
}

/** Clave con el mismo formato que genera el navegador (32 hex). */
const browserKey = () => crypto.randomUUID().replace(/-/g, '');

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  categoryId = (
    await prisma.stockCategory.create({ data: { name: RUN, area: 'HOUSE' }, select: { id: true } })
  ).id;
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Sintético ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = emp.id;
  employeeIds.push(emp.id);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);
  destinationId = (
    await prisma.consumptionDestination.create({
      data: { name: `${RUN}-destino`, type: 'VEHICLE' },
      select: { id: true },
    })
  ).id;
  // kg: 10 con mínimo 20 → bajo; litros: 5 con mínimo 1 → ok; inactivo: 3 con mínimo 1.
  itemKg = await createItem('kg', 'kg', '10', '20');
  itemLiters = await createItem('litros', 'litros', '5', '1');
  itemInactive = await createItem('inactivo', 'kg', '3', '1');

  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) statements.push(summarize(args[0]));
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  counting = false;
  const movementIds = (
    await prisma.stockMovement.findMany({
      where: { stockItemId: { in: itemIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...movementIds, ...itemIds, destinationId, categoryId] } },
      ],
    },
  });
  await prisma.stockMovement.deleteMany({ where: { stockItemId: { in: itemIds } } });
  await prisma.stockItem.deleteMany({ where: { id: { in: itemIds } } });
  if (destinationId) {
    await prisma.consumptionDestination.delete({ where: { id: destinationId } });
  }
  if (categoryId) await prisma.stockCategory.delete({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.stockItem.count({ where: { name: { startsWith: 'test-5c2-' } } })).toBe(0);
  expect(await prisma.stockCategory.count({ where: { name: { startsWith: 'test-5c2-' } } })).toBe(
    0,
  );
  expect(
    await prisma.consumptionDestination.count({ where: { name: { startsWith: 'test-5c2-' } } }),
  ).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5c2-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-5c2-' } } })).toBe(0);
}, 60_000);

describe('flujo idempotente del frontend contra Postgres real', () => {
  it('doble envío con la misma clave (como un doble clic) crea UN movimiento y replay 201 idéntico', async () => {
    const key = browserKey();
    const body = { type: 'INCOME', quantity: '5' };
    const [first, second] = await Promise.all([
      postMovement(employee, itemKg, body, key),
      postMovement(employee, itemKg, body, key),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemKg } })).toBe(1);
    const item = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemKg } });
    expect(item.currentQuantity.toString()).toBe('15');

    // Reintento técnico posterior (misma clave, mismo cuerpo): replay sin escribir.
    const retry = await postMovement(employee, itemKg, body, key);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemKg } })).toBe(1);
  });

  it('carga el resto del período sintético (consumos con/sin destino, ajuste, producto luego inactivo)', async () => {
    const results = [
      await postMovement(
        employee,
        itemKg,
        { type: 'CONSUMPTION', quantity: '2.5', destinationId },
        browserKey(),
      ),
      await postMovement(
        employee,
        itemLiters,
        { type: 'CONSUMPTION', quantity: '1' },
        browserKey(),
      ),
      await postMovement(
        admin,
        itemKg,
        { type: 'ADJUSTMENT_DECREASE', quantity: '0.5', reason: 'Conteo sintético' },
        browserKey(),
      ),
      await postMovement(admin, itemInactive, { type: 'INCOME', quantity: '1' }, browserKey()),
    ];
    expect(results.map((response) => response.status)).toEqual([201, 201, 201, 201]);
    await prisma.stockItem.update({ where: { id: itemInactive }, data: { active: false } });
  });
});

describe('GET /stock/reports/summary — agregaciones reales', () => {
  const summary = (actor: Actor, query: Record<string, string>) =>
    request(app).get('/api/v1/stock/reports/summary').set(as(actor)).query(query);

  it('ADMIN: conteos por tipo, cantidades por unidad (sin mezclar), destinos, personas y niveles', async () => {
    const { result: response, sql } = await countStatements(() =>
      summary(admin, { from: today(), to: today(), categoryId }),
    );
    expect(response.status).toBe(200);
    const body = response.body;
    expect(body.range).toMatchObject({ from: today(), to: today(), timeZone: TZ });
    expect(body.totals).toEqual({
      movements: 5,
      income: {
        count: 2,
        byUnit: [{ unit: 'kg', quantity: '6' }],
      },
      consumption: {
        count: 2,
        byUnit: [
          { unit: 'kg', quantity: '2.5' },
          { unit: 'litros', quantity: '1' },
        ],
      },
      adjustments: { count: 1, increase: 0, decrease: 1 },
      openingBalance: { count: 0 },
    });
    // Nunca un total mezclado de kg + litros.
    expect(JSON.stringify(body.totals)).not.toContain('3.5');

    // Niveles actuales (solo activos de la categoría): kg 12 < 20 → bajo; litros ok.
    expect(body.currentLevels).toMatchObject({ critical: 0, low: 1, ok: 1 });

    expect(body.products.withMovements).toBe(3);
    expect(body.products.mostMoved[0]).toMatchObject({
      item: { id: itemKg, unit: 'kg' },
      movementCount: 3,
      consumed: '2.5',
      income: '5',
    });
    expect(body.products.mostConsumed.map((row: { item: { id: string } }) => row.item.id)).toEqual([
      itemKg,
      itemLiters,
    ]);

    expect(body.destinations).toEqual([
      {
        destination: { id: destinationId, name: `${RUN}-destino`, type: 'VEHICLE', active: true },
        count: 1,
        byUnit: [{ unit: 'kg', quantity: '2.5' }],
      },
      { destination: null, count: 1, byUnit: [{ unit: 'litros', quantity: '1' }] },
    ]);
    const person = body.employees.find(
      (row: { employee: { id: string } | null }) => row.employee?.id === employeeId,
    );
    expect(person).toMatchObject({ total: 3, byType: { INCOME: 1, CONSUMPTION: 2 } });
    const noPerson = body.employees.find((row: { employee: unknown }) => row.employee === null);
    expect(noPerson).toMatchObject({ total: 2 }); // movimientos del ADMIN sin empleado

    // 1 de requireAuth + 5 agregaciones independientes; nunca N+1.
    // eslint-disable-next-line no-console -- solo verbo y tablas, sin valores
    console.info(`[5c2-reports] summary sql=${JSON.stringify(sql)}`);
    expect(sql).toHaveLength(6);
    expect(JSON.stringify(response.body)).not.toMatch(/prisma|pinHash|token|requestHash/i);
  });

  it('EMPLOYEE recibe el mismo reporte que ADMIN (paridad con el prototipo)', async () => {
    const [asEmployee, asAdmin] = await Promise.all([
      summary(employee, { from: today(), to: today(), categoryId }),
      summary(admin, { from: today(), to: today(), categoryId }),
    ]);
    expect(asEmployee.status).toBe(200);
    expect(asEmployee.body).toEqual(asAdmin.body);
    expect(asEmployee.body.totals.movements).toBe(5);
  });

  it('filtros de tipo, destino, persona y producto se aplican en Postgres', async () => {
    const byType = await countStatements(() =>
      summary(admin, { from: today(), to: today(), categoryId, type: 'INCOME' }),
    );
    expect(byType.result.body.totals.movements).toBe(2);
    expect(byType.result.body.destinations).toEqual([]);
    expect(byType.sql).toHaveLength(5); // sin la consulta de destinos

    const byDestination = await summary(admin, {
      from: today(),
      to: today(),
      categoryId,
      destinationId,
    });
    expect(byDestination.body.totals.movements).toBe(1);

    const byPerson = await summary(admin, { from: today(), to: today(), categoryId, employeeId });
    expect(byPerson.body.totals.movements).toBe(3);

    const byItem = await summary(admin, { from: today(), to: today(), itemId: itemLiters });
    expect(byItem.body.totals.consumption.byUnit).toEqual([{ unit: 'litros', quantity: '1' }]);
    expect(byItem.body.currentLevels).toMatchObject({ critical: 0, low: 0, ok: 1 });
  });

  it('valida rango, parámetros desconocidos e ids maliciosos sin filtrar SQL', async () => {
    const future = await summary(admin, { from: '2999-01-01', to: '2999-01-02' });
    expect(future.status).toBe(400);
    const abusive = await summary(admin, { from: '2000-01-01', to: today() });
    expect(abusive.status).toBe(400);
    expect(abusive.body.error.message).toMatch(/366 días/);
    const unknown = await summary(admin, { from: today(), to: today(), orden: 'x' });
    expect(unknown.status).toBe(400);
    const injection = await summary(admin, {
      from: today(),
      to: today(),
      categoryId: "x' OR '1'='1",
    });
    expect(injection.status).toBe(400);
    for (const response of [future, abusive, unknown, injection]) {
      expect(JSON.stringify(response.body)).not.toMatch(/prisma|SELECT|stack|P20\d\d/i);
    }
    const anonymous = await request(app)
      .get('/api/v1/stock/reports/summary')
      .query({ from: today(), to: today() });
    expect(anonymous.status).toBe(401);
  });
});

describe('GET /stock/reports/movements — paginado con JOIN', () => {
  it('pagina en Postgres con producto, persona y destino en UNA sentencia + el total', async () => {
    const { result: page1, sql } = await countStatements(() =>
      request(app)
        .get('/api/v1/stock/reports/movements')
        .set(as(admin))
        .query({ from: today(), to: today(), categoryId, pageSize: '2', page: '1' }),
    );
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect(page1.body.movements).toHaveLength(2);
    // eslint-disable-next-line no-console -- solo verbo y tablas, sin valores
    console.info(`[5c2-reports] movements sql=${JSON.stringify(sql)}`);
    expect(sql).toHaveLength(3); // requireAuth + página + total

    const page3 = await request(app)
      .get('/api/v1/stock/reports/movements')
      .set(as(admin))
      .query({ from: today(), to: today(), categoryId, pageSize: '2', page: '3' });
    expect(page3.body.movements).toHaveLength(1);
    const ids = new Set(
      [...page1.body.movements, ...page3.body.movements].map((row: { id: string }) => row.id),
    );
    expect(ids.size).toBe(3);

    const withDestination = await request(app)
      .get('/api/v1/stock/reports/movements')
      .set(as(admin))
      .query({ from: today(), to: today(), destinationId });
    expect(withDestination.body.movements).toEqual([
      expect.objectContaining({
        type: 'CONSUMPTION',
        quantity: '2.5',
        effectiveDate: today(),
        item: expect.objectContaining({ id: itemKg, unit: 'kg' }),
        employee: expect.objectContaining({ id: employeeId }),
        destination: { id: destinationId, name: `${RUN}-destino`, type: 'VEHICLE' },
      }),
    ]);
  });
});

describe('GET /stock/items?sort=name — Compras', () => {
  it('bajos activos de la categoría, ordenados por nombre, con el stockLevel del backend', async () => {
    const response = await request(app)
      .get('/api/v1/stock/items')
      .set(as(employee))
      .query({ status: 'active', stockLevel: 'low', sort: 'name', categoryId });
    expect(response.status).toBe(200);
    expect(response.body.items.map((row: { id: string }) => row.id)).toEqual([itemKg]);
    expect(response.body.items[0].stockLevel).toBe('low');
  });
});
