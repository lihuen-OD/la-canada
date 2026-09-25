import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Client } from 'pg';
import { Prisma } from '../../generated/prisma/client';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Stock 5C.1 (destinos, `stockLevel`, `Idempotency-Key`) contra Neon real
 * (`demo`), por HTTP real (app Express completa, `requireAuth` con sesiones
 * y JWT reales de usuarios SINTÉTICOS). Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-5c1-<RUN_ID>`;
 *  - nunca se mueve saldo, se edita ni se lee con escritura ningún producto,
 *    categoría, destino, usuario ni empleado preexistente;
 *  - los fallos de rollback se provocan envolviendo el cliente Prisma REAL:
 *    la transacción y su ROLLBACK ocurren en Postgres de verdad;
 *  - `afterAll` borra solo las filas creadas por esta corrida (por id) y
 *    verifica que los conteos globales y las filas reales vuelven
 *    exactamente a su estado inicial.
 */

const faults = vi.hoisted(() => ({
  failMovementCreate: false,
  failIdempotencyUpdate: false,
  /** Falla la N-ésima creación de auditoría (1 = la primera) dentro de una transacción. */
  failAuditAt: 0,
  auditCalls: 0,
}));

vi.mock('../../lib/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/prisma')>();
  const real = actual.prisma as unknown as Record<string | symbol, unknown>;

  function failing(delegate: object, method: string, shouldFail: () => boolean, label: string) {
    return new Proxy(delegate, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (prop === method && shouldFail()) {
          return async () => {
            throw new Error(`fallo sintético: ${label}`);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function wrapTx(tx: object) {
    return new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target) as unknown;
        if (prop === 'stockMovement') {
          return failing(value as object, 'create', () => faults.failMovementCreate, 'movimiento');
        }
        if (prop === 'idempotencyRecord') {
          return failing(
            value as object,
            'update',
            () => faults.failIdempotencyUpdate,
            'finalización idempotente',
          );
        }
        if (prop === 'auditLog') {
          return failing(
            value as object,
            'create',
            () => faults.failAuditAt > 0 && ++faults.auditCalls === faults.failAuditAt,
            'auditoría',
          );
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const wrapped = new Proxy(real, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (arg: unknown, options?: unknown) =>
          typeof arg === 'function'
            ? (target.$transaction as (fn: unknown, o?: unknown) => unknown)(
                (tx: object) => (arg as (tx: object) => unknown)(wrapTx(tx)),
                options,
              )
            : (target.$transaction as (a: unknown, o?: unknown) => unknown)(arg, options);
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { ...actual, prisma: wrapped };
});

const RUN = `test-5c1-${Date.now()}`;
const TZ = config.businessTimeZone;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employeeA: Actor;
let employeeB: Actor;
let categoryId = '';
const syntheticUserIds: string[] = [];
const syntheticEmployeeIds: string[] = [];
const syntheticItemIds: string[] = [];
const syntheticDestinationIds: string[] = [];

let baseline: Record<string, number>;
let realSnapshotBefore: unknown;

function resetFaults() {
  faults.failMovementCreate = false;
  faults.failIdempotencyUpdate = false;
  faults.failAuditAt = 0;
  faults.auditCalls = 0;
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

/** Filas reales (todo lo que no es de esta corrida), con los campos que un test podría alterar. */
async function realSnapshot() {
  const notRun = { NOT: { name: { startsWith: 'test-5c1-' } } };
  return {
    items: await prisma.stockItem.findMany({
      where: notRun,
      select: {
        id: true,
        name: true,
        area: true,
        categoryId: true,
        unit: true,
        minimumQuantity: true,
        currentQuantity: true,
        active: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    categories: await prisma.stockCategory.findMany({
      where: notRun,
      select: { id: true, name: true, area: true, active: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    destinations: await prisma.consumptionDestination.findMany({
      where: notRun,
      orderBy: { id: 'asc' },
    }),
    openingMovements: await prisma.stockMovement.findMany({
      where: { type: 'OPENING_BALANCE' },
      select: { id: true, stockItemId: true, quantity: true, reference: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    users: await prisma.user.findMany({
      where: { NOT: { username: { startsWith: 'test-5c1-' } } },
      select: { id: true, role: true, status: true, employeeId: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
    employees: await prisma.employee.findMany({
      where: { NOT: { code: { startsWith: 'test-5c1-' } } },
      select: { id: true, active: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  };
}

async function createEmployee(suffix: string): Promise<string> {
  const employee = await prisma.employee.create({
    data: {
      code: `${RUN}-${suffix}`,
      displayName: `Sintético ${suffix} ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  syntheticEmployeeIds.push(employee.id);
  return employee.id;
}

async function createActor(
  role: 'ADMIN' | 'EMPLOYEE',
  suffix: string,
  employeeId?: string,
): Promise<Actor> {
  const user = await prisma.user.create({
    // pinHash sintético no verificable: estos usuarios nunca hacen login por PIN.
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  syntheticUserIds.push(user.id);
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

async function createItem(suffix: string, current: string, minimum = '1'): Promise<string> {
  const item = await prisma.stockItem.create({
    data: {
      name: `${RUN}-${suffix}`,
      area: 'HOUSE',
      categoryId,
      unit: 'unidades',
      minimumQuantity: new Prisma.Decimal(minimum),
      currentQuantity: new Prisma.Decimal(current),
    },
    select: { id: true },
  });
  syntheticItemIds.push(item.id);
  return item.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

function postMovement(actor: Actor, itemId: string, body: object, key?: string) {
  const req = request(app).post(`/api/v1/stock/items/${itemId}/movements`).set(as(actor));
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
}

function expectCleanError(body: unknown, code: string) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(
    /prisma|P20\d\d|stack|constraint|SELECT|INSERT|requestHash|request_hash/i,
  );
  expect(body).toMatchObject({ error: { code } });
  expect(Object.keys((body as { error: object }).error).sort()).toEqual(['code', 'message']);
}

function expectPublicMovementBody(body: unknown) {
  expect(Object.keys(body as object).sort()).toEqual(['item', 'movement']);
  expect(JSON.stringify(body)).not.toMatch(
    /"kind"|requestHash|request_hash|idempotency|responseBody|completedAt|pinHash|token/i,
  );
}

async function balance(itemId: string): Promise<string> {
  const item = await prisma.stockItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { currentQuantity: true },
  });
  return item.currentQuantity.toString();
}

const movementCount = (itemId: string) =>
  prisma.stockMovement.count({ where: { stockItemId: itemId } });

async function movementAuditCount(itemId: string): Promise<number> {
  const ids = (
    await prisma.stockMovement.findMany({ where: { stockItemId: itemId }, select: { id: true } })
  ).map((row) => row.id);
  return prisma.auditLog.count({
    where: { action: 'stock.movement.created', entityId: { in: ids } },
  });
}

const recordsFor = (actor: Actor, key: string) =>
  prisma.idempotencyRecord.findMany({ where: { actorUserId: actor.userId, key } });

const todayText = () => formatLocalDate(toLocalDate(new Date(), TZ));

beforeAll(async () => {
  baseline = await globalCounts();
  realSnapshotBefore = await realSnapshot();

  app = createApp();
  const category = await prisma.stockCategory.create({
    data: { name: RUN, area: 'HOUSE' },
    select: { id: true },
  });
  categoryId = category.id;
  const empA = await createEmployee('emp-a');
  const empB = await createEmployee('emp-b');
  admin = await createActor('ADMIN', 'admin');
  employeeA = await createActor('EMPLOYEE', 'emp-a', empA);
  employeeB = await createActor('EMPLOYEE', 'emp-b', empB);
}, 60_000);

afterAll(async () => {
  resetFaults();
  const movementIds = (
    await prisma.stockMovement.findMany({
      where: { stockItemId: { in: syntheticItemIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: syntheticUserIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: syntheticUserIds } },
        {
          entityId: {
            in: [...movementIds, ...syntheticItemIds, ...syntheticDestinationIds, categoryId],
          },
        },
      ],
    },
  });
  await prisma.stockMovement.deleteMany({ where: { stockItemId: { in: syntheticItemIds } } });
  await prisma.stockItem.deleteMany({ where: { id: { in: syntheticItemIds } } });
  await prisma.consumptionDestination.deleteMany({
    where: { id: { in: syntheticDestinationIds } },
  });
  if (categoryId) await prisma.stockCategory.delete({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: syntheticUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: syntheticUserIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: syntheticEmployeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await realSnapshot()).toEqual(realSnapshotBefore);
  expect(
    await prisma.consumptionDestination.count({ where: { name: { startsWith: 'test-5c1-' } } }),
  ).toBe(0);
  expect(await prisma.stockItem.count({ where: { name: { startsWith: 'test-5c1-' } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5c1-' } } })).toBe(0);
}, 60_000);

// ── Idempotencia ──────────────────────────────────────────────────────────

describe('Idempotency-Key — contrato real contra Postgres', () => {
  it('primera solicitud crea UNA operación; replay devuelve 201 y el mismo resultado', async () => {
    const itemId = await createItem('replay', '5');
    const key = `${RUN}-replay`.slice(-40);
    const first = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1' }, key);
    expect(first.status).toBe(201);
    expectPublicMovementBody(first.body);
    expect(first.body.item.currentQuantity).toBe('6');

    // Segunda: la reserva choca con el unique REAL de Postgres (P2002 vía adapter-pg).
    const replay = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1' }, key);
    expect(replay.status).toBe(201);
    expectPublicMovementBody(replay.body);
    expect(replay.body).toEqual(first.body);

    expect(await balance(itemId)).toBe('6');
    expect(await movementCount(itemId)).toBe(1);
    expect(await movementAuditCount(itemId)).toBe(1);
    const records = await recordsFor(employeeA, key);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      responseStatus: 201,
      endpoint: `POST /stock/items/${itemId}/movements`,
    });
    expect(records[0]?.completedAt).not.toBeNull();
    expect(records[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('misma clave con body distinto → 409 IDEMPOTENCY_KEY_CONFLICT sin escribir', async () => {
    const itemId = await createItem('conflict', '5');
    const key = `${RUN}-conflict`.slice(-40);
    expect(
      (await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1' }, key)).status,
    ).toBe(201);
    const conflict = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '2' }, key);
    expect(conflict.status).toBe(409);
    expectCleanError(conflict.body, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(await balance(itemId)).toBe('6');
    expect(await movementCount(itemId)).toBe(1);
    expect(await movementAuditCount(itemId)).toBe(1);
  });

  it('otro actor y otro producto no comparten la reserva', async () => {
    const itemA = await createItem('scope-a', '5');
    const itemB = await createItem('scope-b', '5');
    const key = `${RUN}-scope`.slice(-40);
    const body = { type: 'INCOME', quantity: '1' };
    expect((await postMovement(employeeA, itemA, body, key)).status).toBe(201);
    expect((await postMovement(employeeB, itemA, body, key)).status).toBe(201);
    expect((await postMovement(employeeA, itemB, body, key)).status).toBe(201);
    expect(await balance(itemA)).toBe('7');
    expect(await balance(itemB)).toBe('6');
    expect(await movementCount(itemA)).toBe(2);
    expect(await movementCount(itemB)).toBe(1);
    expect(await recordsFor(employeeA, key)).toHaveLength(2);
    expect(await recordsFor(employeeB, key)).toHaveLength(1);
  });

  it('clave inválida → 400 IDEMPOTENCY_KEY_INVALID sin escribir; sin clave → comportamiento 5A', async () => {
    const itemId = await createItem('invalid-key', '5');
    const invalid = await postMovement(
      employeeA,
      itemId,
      { type: 'INCOME', quantity: '1' },
      'corta',
    );
    expect(invalid.status).toBe(400);
    expectCleanError(invalid.body, 'IDEMPOTENCY_KEY_INVALID');
    expect(await movementCount(itemId)).toBe(0);

    const idempotencyBefore = await prisma.idempotencyRecord.count();
    const plainA = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1' });
    const plainB = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1' });
    expect([plainA.status, plainB.status]).toEqual([201, 201]);
    expectPublicMovementBody(plainA.body);
    expect(await movementCount(itemId)).toBe(2);
    expect(await balance(itemId)).toBe('7');
    expect(await prisma.idempotencyRecord.count()).toBe(idempotencyBefore);
  });

  it('UUID en mayúsculas + decimal equivalente → replay, nunca una segunda operación', async () => {
    const itemId = await createItem('uuid-case', '5');
    const key = `${RUN}-uuidcase`.slice(-40);
    const first = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '1.5' }, key);
    expect(first.status).toBe(201);
    const upper = await postMovement(
      employeeA,
      itemId.toUpperCase(),
      { type: 'INCOME', quantity: '1.50' },
      key,
    );
    expect(upper.status).toBe(201);
    expect(upper.body).toEqual(first.body);
    expect(await balance(itemId)).toBe('6.5');
    expect(await movementCount(itemId)).toBe(1);
    expect(await recordsFor(employeeA, key)).toHaveLength(1);
  });

  it('la fecha efectiva resuelta forma parte de la identidad', async () => {
    const itemId = await createItem('date', '5');
    const key = `${RUN}-date`.slice(-40);
    // ADMIN omite la fecha → se resuelve a hoy (zona de negocio).
    expect((await postMovement(admin, itemId, { type: 'INCOME', quantity: '1' }, key)).status).toBe(
      201,
    );
    // Hoy explícito es la MISMA identidad → replay.
    const sameDay = await postMovement(
      admin,
      itemId,
      { type: 'INCOME', quantity: '1', effectiveDate: todayText() },
      key,
    );
    expect(sameDay.status).toBe(201);
    // Otra fecha con la misma clave → conflicto, nunca replay silencioso.
    const yesterday = formatLocalDate(addDays(toLocalDate(new Date(), TZ), -1));
    const otherDay = await postMovement(
      admin,
      itemId,
      { type: 'INCOME', quantity: '1', effectiveDate: yesterday },
      key,
    );
    expect(otherDay.status).toBe(409);
    expectCleanError(otherDay.body, 'IDEMPOTENCY_KEY_CONFLICT');
    expect(await movementCount(itemId)).toBe(1);
    expect(await balance(itemId)).toBe('6');
  });
});

// ── Concurrencia real ─────────────────────────────────────────────────────

describe('Idempotency-Key — concurrencia real (mismo actor, producto, clave y body)', () => {
  it.each([
    ['INCOME', '10', '11'],
    ['CONSUMPTION', '10', '9'],
  ] as const)(
    '%s: 6 solicitudes simultáneas → un solo movimiento, saldo, auditoría y registro',
    async (type, start, expected) => {
      const itemId = await createItem(`concurrent-${type.toLowerCase()}`, start);
      const key = `${RUN}-conc-${type}`.slice(-40);
      const body = { type, quantity: '1' };
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => postMovement(employeeA, itemId, body, key)),
      );
      const statuses = responses.map((response) => response.status);
      for (const response of responses) {
        if (response.status === 201) {
          expectPublicMovementBody(response.body);
        } else {
          expect(response.status).toBe(409);
          expectCleanError(response.body, 'IDEMPOTENCY_RECORD_PENDING');
        }
      }
      expect(statuses).not.toContain(500);
      const created = responses.filter((response) => response.status === 201);
      expect(created.length).toBeGreaterThanOrEqual(1);
      // Todas las 201 son la MISMA operación (una creación + replays).
      const movementIds = new Set(created.map((response) => response.body.movement.id));
      expect(movementIds.size).toBe(1);

      expect(await movementCount(itemId)).toBe(1);
      expect(await balance(itemId)).toBe(expected);
      expect(await movementAuditCount(itemId)).toBe(1);
      const records = await recordsFor(employeeA, key);
      expect(records).toHaveLength(1);
      expect(records[0]?.completedAt).not.toBeNull();
      expect(records[0]?.responseStatus).toBe(201);
      // Evidencia para el reporte: distribución de estados observada.
      // eslint-disable-next-line no-console -- solo códigos HTTP, sin datos
      console.info(`[5c1] concurrencia ${type}: ${JSON.stringify(statuses)}`);
    },
    60_000,
  );
});

// ── Rollback real ─────────────────────────────────────────────────────────

describe('Idempotency-Key — rollback real en Postgres', () => {
  it.each([
    [
      'creación del movimiento',
      'movement',
      (): void => {
        faults.failMovementCreate = true;
      },
    ],
    [
      'auditoría',
      'audit',
      (): void => {
        faults.failAuditAt = 1;
      },
    ],
    [
      'finalización del registro',
      'complete',
      (): void => {
        faults.failIdempotencyUpdate = true;
      },
    ],
  ] as const)(
    'si falla la %s no queda saldo, movimiento, auditoría ni reserva; el reintento funciona',
    async (_label, slug, arm) => {
      const itemId = await createItem(`rollback-${slug}`, '5');
      const key = `${RUN}-rb-${slug}`.slice(-40);
      const auditsBefore = await prisma.auditLog.count();
      resetFaults();
      arm();
      try {
        const failed = await postMovement(
          employeeA,
          itemId,
          { type: 'INCOME', quantity: '2' },
          key,
        );
        // Error no operacional inyectado → 500 genérico (fuera de production el
        // errorHandler adjunta `stack`, comportamiento preexistente de desarrollo).
        expect(failed.status).toBe(500);
        expect(failed.body.error.message).toBe('Error interno del servidor');
      } finally {
        resetFaults();
      }
      expect(await balance(itemId)).toBe('5');
      expect(await movementCount(itemId)).toBe(0);
      expect(await prisma.auditLog.count()).toBe(auditsBefore);
      expect(await recordsFor(employeeA, key)).toHaveLength(0);

      const retry = await postMovement(employeeA, itemId, { type: 'INCOME', quantity: '2' }, key);
      expect(retry.status).toBe(201);
      expect(await balance(itemId)).toBe('7');
      expect(await movementCount(itemId)).toBe(1);
    },
  );
});

// ── stockLevel server-side (SQL real) ─────────────────────────────────────

describe('GET /stock/items?stockLevel — SQL parametrizado real', () => {
  it('critical/low/ok se resuelven en Postgres, con conteo y DTO coherentes', async () => {
    const critical = await createItem('lvl-critical', '0', '0');
    const low = await createItem('lvl-low', '2', '3');
    const ok = await createItem('lvl-ok', '3', '3');
    const list = (level: string) =>
      request(app)
        .get('/api/v1/stock/items')
        .query({ stockLevel: level, q: `${RUN}-lvl-`, status: 'all' })
        .set(as(admin));
    for (const [level, id] of [
      ['critical', critical],
      ['low', low],
      ['ok', ok],
    ] as const) {
      const response = await list(level);
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.items.map((item: { id: string }) => item.id)).toEqual([id]);
      expect(response.body.items[0].stockLevel).toBe(level);
      expect(response.body.items[0]).not.toHaveProperty('barPercent');
    }
    const invalid = await list('bajo');
    expect(invalid.status).toBe(400);
  });
});

// ── Destinos ──────────────────────────────────────────────────────────────

describe('/stock/destinations — permisos, auditoría y sin borrado físico', () => {
  it('EMPLOYEE no administra ni ve inactivos; ADMIN crea, renombra e inactiva con auditoría', async () => {
    const name = `${RUN}-dest-1`;
    expect(
      (
        await request(app)
          .post('/api/v1/stock/destinations')
          .set(as(employeeA))
          .send({ name, type: 'VEHICLE' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).get('/api/v1/stock/destinations?status=all').set(as(employeeA))).status,
    ).toBe(403);

    const created = await request(app)
      .post('/api/v1/stock/destinations')
      .set(as(admin))
      .send({ name, type: 'VEHICLE' });
    expect(created.status).toBe(201);
    const destinationId = created.body.destination.id as string;
    syntheticDestinationIds.push(destinationId);
    expect(created.body.destination).toEqual({
      id: destinationId,
      name,
      type: 'VEHICLE',
      active: true,
    });

    const duplicate = await request(app)
      .post('/api/v1/stock/destinations')
      .set(as(admin))
      .send({ name, type: 'SECTOR' });
    expect(duplicate.status).toBe(409);
    expectCleanError(duplicate.body, 'STOCK_DESTINATION_DUPLICATE');

    const typeChange = await request(app)
      .patch(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin))
      .send({ type: 'SECTOR' });
    expect(typeChange.status).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/v1/stock/destinations/${destinationId}`)
          .set(as(employeeA))
          .send({ name: `${name}-x` })
      ).status,
    ).toBe(403);

    const renamed = await request(app)
      .patch(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin))
      .send({ name: `${name}-renombrado` });
    expect(renamed.status).toBe(200);
    expect(renamed.body.destination).toMatchObject({ name: `${name}-renombrado`, type: 'VEHICLE' });

    const deactivated = await request(app)
      .patch(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin))
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.destination.active).toBe(false);

    const activeList = await request(app).get('/api/v1/stock/destinations').set(as(employeeA));
    expect(activeList.status).toBe(200);
    expect(activeList.body.destinations.map((d: { id: string }) => d.id)).not.toContain(
      destinationId,
    );
    const allList = await request(app).get('/api/v1/stock/destinations?status=all').set(as(admin));
    expect(allList.body.destinations).toContainEqual({
      id: destinationId,
      name: `${name}-renombrado`,
      type: 'VEHICLE',
      active: false,
    });

    const reactivated = await request(app)
      .patch(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin))
      .send({ active: true });
    expect(reactivated.body.destination.active).toBe(true);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: destinationId },
      select: { action: true, actorUserId: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      'stock.destination.created',
      'stock.destination.updated',
      'stock.destination.status_changed',
      'stock.destination.status_changed',
    ]);
    expect(audits.every((audit) => audit.actorUserId === admin.userId)).toBe(true);

    const deleted = await request(app)
      .delete(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin));
    expect(deleted.status).toBe(404);
    expect(await prisma.consumptionDestination.count({ where: { id: destinationId } })).toBe(1);
  });

  it('inexistente → 404; destino inactivo rechaza consumos y uno activo los acepta', async () => {
    const missing = await request(app)
      .patch('/api/v1/stock/destinations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .set(as(admin))
      .send({ active: false });
    expect(missing.status).toBe(404);
    expectCleanError(missing.body, 'STOCK_DESTINATION_NOT_FOUND');

    const created = await request(app)
      .post('/api/v1/stock/destinations')
      .set(as(admin))
      .send({ name: `${RUN}-dest-2`, type: 'SECTOR' });
    expect(created.status).toBe(201);
    const destinationId = created.body.destination.id as string;
    syntheticDestinationIds.push(destinationId);
    const itemId = await createItem('dest-consumo', '5');

    const accepted = await postMovement(employeeA, itemId, {
      type: 'CONSUMPTION',
      quantity: '1',
      destinationId,
    });
    expect(accepted.status).toBe(201);
    expect(accepted.body.movement.destination).toEqual({
      id: destinationId,
      name: `${RUN}-dest-2`,
      type: 'SECTOR',
    });

    await request(app)
      .patch(`/api/v1/stock/destinations/${destinationId}`)
      .set(as(admin))
      .send({ active: false });
    const rejected = await postMovement(employeeA, itemId, {
      type: 'CONSUMPTION',
      quantity: '1',
      destinationId,
    });
    expect(rejected.status).toBe(409);
    expectCleanError(rejected.body, 'STOCK_DESTINATION_INACTIVE');
    expect(await balance(itemId)).toBe('4');
  });

  it('si falla la segunda auditoría, nombre y estado se revierten juntos', async () => {
    const created = await request(app)
      .post('/api/v1/stock/destinations')
      .set(as(admin))
      .send({ name: `${RUN}-dest-3`, type: 'VEHICLE' });
    const destinationId = created.body.destination.id as string;
    syntheticDestinationIds.push(destinationId);
    const auditsBefore = await prisma.auditLog.count({ where: { entityId: destinationId } });

    resetFaults();
    faults.failAuditAt = 2;
    try {
      const failed = await request(app)
        .patch(`/api/v1/stock/destinations/${destinationId}`)
        .set(as(admin))
        .send({ name: `${RUN}-dest-3-nuevo`, active: false });
      expect(failed.status).toBe(500);
    } finally {
      resetFaults();
    }
    const row = await prisma.consumptionDestination.findUniqueOrThrow({
      where: { id: destinationId },
    });
    expect(row).toMatchObject({ name: `${RUN}-dest-3`, active: true });
    expect(await prisma.auditLog.count({ where: { entityId: destinationId } })).toBe(auditsBefore);
  });
});

// ── CHECK de saldo no negativo ────────────────────────────────────────────

describe('stock_items_current_quantity_non_negative_check — Postgres real, siempre ROLLBACK', () => {
  it('rechaza un saldo negativo y no deja la fila persistida', async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const name = `${RUN}-check-rollback`;
    try {
      await client.query('BEGIN');
      try {
        const item = await client.query(
          `INSERT INTO stock_items (id, name, area, category_id, unit, minimum_quantity, updated_at)
           VALUES (gen_random_uuid(), $1, 'HOUSE', $2, 'unidades', 1, now())
           RETURNING id`,
          [name, categoryId],
        );
        await expect(
          client.query('UPDATE stock_items SET current_quantity = -0.01 WHERE id = $1', [
            item.rows[0].id,
          ]),
        ).rejects.toThrow(/stock_items_current_quantity_non_negative_check/);
      } finally {
        await client.query('ROLLBACK');
      }
    } finally {
      await client.end();
    }
    expect(await prisma.stockItem.count({ where: { name } })).toBe(0);
  });
});
