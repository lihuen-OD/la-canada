import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * 🐔 Gallinero (Etapa 5G) contra Neon real (`demo`) por HTTP real. Reglas:
 *  - todo lo creado lleva el prefijo `test-5g-<RUN>` (usuarios, empleados)
 *    y las recolecciones son de esos empleados sintéticos;
 *  - el gallinero `main` es un singleton REAL: si ya existe al empezar, no
 *    se modifica (solo se prueban los caminos que no escriben); si no
 *    existe, se crea para la prueba y se borra al final;
 *  - las cifras se afirman como DIFERENCIAS respecto de una lectura previa,
 *    nunca como totales absolutos (no se asumen datos reales);
 *  - `afterAll` borra solo lo creado (por id) y verifica 0 residuos y
 *    conteos globales idénticos a los iniciales.
 */

const RUN = `test-5g-${Date.now()}`;
const TZ = config.businessTimeZone;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let employeeId = '';
let otherEmployeeId = '';
let inactiveEmployeeId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: Record<string, number>;
/** El gallinero real ya existía: no se toca. */
let coopPreexisting = false;

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
    coops: await prisma.chickenCoop.count(),
    collections: await prisma.eggCollection.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
}

async function createEmployee(suffix: string, active = true) {
  const row = await prisma.employee.create({
    data: {
      code: `${RUN}-${suffix}`,
      displayName: `Sintético ${suffix}`,
      role: 'Test',
      colorHex: '#4a7c59',
      active,
    },
    select: { id: true },
  });
  employeeIds.push(row.id);
  return row.id;
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

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const today = () => toLocalDate(new Date(), TZ);
const todayText = () => formatLocalDate(today());
const key = () => crypto.randomUUID().replace(/-/g, '');

const getSummary = (actor: Actor, days = 7) =>
  request(app).get(`/api/v1/chicken-coop/summary?days=${days}`).set(as(actor));
const postCollection = (actor: Actor, body: object, idempotencyKey?: string) => {
  const call = request(app).post('/api/v1/chicken-coop/collections').set(as(actor));
  return (idempotencyKey ? call.set('Idempotency-Key', idempotencyKey) : call).send(body);
};
const voidCollection = (actor: Actor, id: string) =>
  request(app).post(`/api/v1/chicken-coop/collections/${id}/void`).set(as(actor)).send({});
const adjust = (actor: Actor, delta: 1 | -1, expectedCount: number) =>
  request(app)
    .post('/api/v1/chicken-coop/hens-adjustments')
    .set(as(actor))
    .send({ delta, expectedCount });

beforeAll(async () => {
  baseline = await globalCounts();
  coopPreexisting = (await prisma.chickenCoop.count({ where: { code: 'main' } })) > 0;
  app = createApp();
  employeeId = await createEmployee('emp');
  otherEmployeeId = await createEmployee('otro');
  inactiveEmployeeId = await createEmployee('inactivo', false);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);

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
  const collectionIds = (
    await prisma.eggCollection.findMany({
      where: {
        OR: [{ employeeId: { in: employeeIds } }, { recordedByUserId: { in: userIds } }],
      },
      select: { id: true },
    })
  ).map((row) => row.id);
  const coopIds = coopPreexisting
    ? []
    : (await prisma.chickenCoop.findMany({ where: { code: 'main' }, select: { id: true } })).map(
        (row) => row.id,
      );
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...collectionIds, ...coopIds] } }],
    },
  });
  await prisma.eggCollection.deleteMany({ where: { id: { in: collectionIds } } });
  if (coopIds.length) await prisma.chickenCoop.deleteMany({ where: { id: { in: coopIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5g-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-5g-' } } })).toBe(0);
  expect(
    await prisma.eggCollection.count({ where: { employee: { code: { startsWith: 'test-5g-' } } } }),
  ).toBe(0);
}, 60_000);

describe('gallinas activas (singleton "main")', () => {
  it('EMPLOYEE no configura ni da altas/bajas', async () => {
    const configure = await request(app)
      .post('/api/v1/chicken-coop/configuration')
      .set(as(employee))
      .send({ activeHensCount: 5 });
    expect(configure.status).toBe(403);
    expect((await adjust(employee, 1, 0)).status).toBe(403);
  });

  it('sin configuración: pendiente visible; la configuración inicial concurrente crea UNA fila', async () => {
    if (coopPreexisting) {
      const summary = await getSummary(admin);
      expect(summary.body.coop.configured).toBe(true);
      const again = await request(app)
        .post('/api/v1/chicken-coop/configuration')
        .set(as(admin))
        .send({ activeHensCount: 5 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CHICKEN_COOP_ALREADY_CONFIGURED');
      return;
    }
    const before = await getSummary(employee);
    expect(before.status).toBe(200);
    expect(before.body.coop).toEqual({ configured: false, activeHensCount: null, updatedAt: null });
    expect(before.body.today.layingRate).toBeNull();

    const responses = await Promise.all(
      [10, 11, 12].map((count) =>
        request(app)
          .post('/api/v1/chicken-coop/configuration')
          .set(as(admin))
          .send({ activeHensCount: count }),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await prisma.chickenCoop.count({ where: { code: 'main' } })).toBe(1);
    const coop = await prisma.chickenCoop.findUniqueOrThrow({ where: { code: 'main' } });
    expect(await prisma.auditLog.count({ where: { entityId: coop.id } })).toBe(1);
  });

  it('altas/bajas condicionadas: de 4 simultáneas con la misma cantidad confirmada, aplica UNA', async () => {
    const coop = await prisma.chickenCoop.findUniqueOrThrow({ where: { code: 'main' } });
    if (coopPreexisting) {
      // Nunca se modifica un gallinero real: solo el camino que no escribe.
      const stale = await adjust(admin, 1, coop.activeHensCount + 1000);
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('CHICKEN_COOP_COUNT_CHANGED');
      return;
    }
    const start = coop.activeHensCount;
    const responses = await Promise.all([1, 1, 1, 1].map(() => adjust(admin, 1, start)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(responses.filter((r) => r.status === 409).map((r) => r.body.error.code)).toEqual([
      'CHICKEN_COOP_COUNT_CHANGED',
      'CHICKEN_COOP_COUNT_CHANGED',
      'CHICKEN_COOP_COUNT_CHANGED',
    ]);
    const after = await prisma.chickenCoop.findUniqueOrThrow({ where: { code: 'main' } });
    expect(after.activeHensCount).toBe(start + 1);
    const down = await adjust(admin, -1, start + 1);
    expect(down.status).toBe(200);
    expect(down.body.coop.activeHensCount).toBe(start);
    expect(
      await prisma.auditLog.count({
        where: { entityId: coop.id, action: 'chicken_coop.hens_adjusted' },
      }),
    ).toBe(2);
  });

  it('el CHECK de Postgres impide una cantidad negativa por cualquier otra vía (ROLLBACK)', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "chicken_coops" ("id","code","active_hens_count","updated_at") VALUES (gen_random_uuid(), ${`${RUN}-neg`}, -1, now())`;
      }),
    ).rejects.toThrow(/chicken_coops_active_hens_count_non_negative_check/);
    expect(await prisma.chickenCoop.count({ where: { code: `${RUN}-neg` } })).toBe(0);
  });
});

describe('recolecciones', () => {
  it('EMPLOYEE registra hoy a su nombre; actor real y auditoría separados de la persona', async () => {
    const before = await getSummary(employee);
    const response = await postCollection(employee, {
      goodEggsCount: 6,
      brokenEggsCount: 1,
      notes: 'gallina clueca',
    });
    expect(response.status).toBe(201);
    expect(response.body.collection).toMatchObject({
      collectionDate: todayText(),
      goodEggsCount: 6,
      brokenEggsCount: 1,
      notes: 'gallina clueca',
      employee: { id: employeeId },
    });
    const row = await prisma.eggCollection.findUniqueOrThrow({
      where: { id: response.body.collection.id },
    });
    expect(row.recordedByUserId).toBe(employee.userId);
    expect(row.voidedAt).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: row.id,
          actorUserId: employee.userId,
          action: 'chicken_coop.collection_created',
        },
      }),
    ).toBe(1);

    const after = await getSummary(employee);
    expect(after.body.today.goodEggs - before.body.today.goodEggs).toBe(6);
    expect(after.body.today.brokenEggs - before.body.today.brokenEggs).toBe(1);
    expect(after.body.period.goodEggs - before.body.period.goodEggs).toBe(6);
  });

  it('EMPLOYEE no registra por otra persona; ADMIN sin empleado debe elegir y solo empleados activos', async () => {
    const forged = await postCollection(employee, {
      goodEggsCount: 1,
      brokenEggsCount: 0,
      employeeId: otherEmployeeId,
    });
    expect(forged.status).toBe(403);
    const missing = await postCollection(admin, { goodEggsCount: 1, brokenEggsCount: 0 });
    expect(missing.status).toBe(400);
    const inactive = await postCollection(admin, {
      goodEggsCount: 1,
      brokenEggsCount: 0,
      employeeId: inactiveEmployeeId,
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('EGG_COLLECTOR_INVALID');

    const chosen = await postCollection(admin, {
      goodEggsCount: 2,
      brokenEggsCount: 0,
      employeeId: otherEmployeeId,
      collectionDate: formatLocalDate(addDays(today(), -1)),
    });
    expect(chosen.status).toBe(201);
    expect(chosen.body.collection.employee.id).toBe(otherEmployeeId);
    const row = await prisma.eggCollection.findUniqueOrThrow({
      where: { id: chosen.body.collection.id },
    });
    expect(row.recordedByUserId).toBe(admin.userId);
  });

  it('fecha futura (según BUSINESS_TIME_ZONE) y 0 huevos se rechazan; el CHECK es el piso final', async () => {
    const future = await postCollection(employee, {
      goodEggsCount: 1,
      brokenEggsCount: 0,
      collectionDate: formatLocalDate(addDays(today(), 1)),
    });
    expect(future.status).toBe(400);
    const empty = await postCollection(employee, { goodEggsCount: 0, brokenEggsCount: 0 });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('Ingresá al menos un huevo.');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "egg_collections" ("id","collection_date","good_eggs_count","broken_eggs_count","employee_id","updated_at") VALUES (gen_random_uuid(), '2001-01-01', 0, 0, ${employeeId}::uuid, now())`;
      }),
    ).rejects.toThrow(/egg_collections_at_least_one_egg_check/);
  });

  it('Idempotency-Key: doble envío simultáneo crea UNA recolección y replay 201 idéntico; otro cuerpo → 409', async () => {
    const idempotencyKey = key();
    const body = { goodEggsCount: 3, brokenEggsCount: 0, collectionDate: '2001-01-02' };
    const [first, second] = await Promise.all([
      postCollection(employee, body, idempotencyKey),
      postCollection(employee, body, idempotencyKey),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.collection.id).toBe(first.body.collection.id);
    expect(
      await prisma.eggCollection.count({
        where: { employeeId, collectionDate: new Date('2001-01-02T00:00:00Z') },
      }),
    ).toBe(1);
    const conflict = await postCollection(employee, { ...body, goodEggsCount: 4 }, idempotencyKey);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });
});

describe('historial, anulación y consultas', () => {
  it('historial agrupado por fecha, paginado por días, con un número FIJO de sentencias (sin N+1)', async () => {
    await postCollection(employee, {
      goodEggsCount: 5,
      brokenEggsCount: 2,
      collectionDate: '2001-01-03',
    });
    await postCollection(admin, {
      goodEggsCount: 1,
      brokenEggsCount: 0,
      collectionDate: '2001-01-03',
      employeeId: otherEmployeeId,
    });
    const first = await request(app)
      .get('/api/v1/chicken-coop/collections?pageSize=31')
      .set(as(employee));
    expect(first.status).toBe(200);
    const { result, sql } = await countStatements(() =>
      request(app)
        .get(`/api/v1/chicken-coop/collections?pageSize=31&page=${first.body.totalPages}`)
        .set(as(employee)),
    );
    // auth + singleton + página de fechas + total de fechas + recolecciones
    // + sus personas (Prisma resuelve el `select` anidado como una sentencia
    // aparte, ver ARCHITECTURE §22). Fijo: no depende de cuántos días o
    // recolecciones trae la página.
    expect(sql, sql.join(' | ')).toHaveLength(6);
    expect(sql.filter((statement) => statement.includes('employees'))).toHaveLength(2);
    const day = result.body.days.find((entry: { date: string }) => entry.date === '2001-01-03');
    expect(day).toMatchObject({ goodEggs: 6, brokenEggs: 2 });
    expect(day.collections).toHaveLength(2);
    // Más reciente primero dentro del día.
    expect(day.collections[0].employee.id).toBe(otherEmployeeId);
  });

  it('el resumen se resuelve en auth + 2 sentencias (singleton + GROUP BY)', async () => {
    const { result, sql } = await countStatements(() => getSummary(employee, 365));
    expect(result.status).toBe(200);
    expect(result.body.period.daily).toHaveLength(14);
    expect(sql).toHaveLength(3);
  });

  it('solo ADMIN elimina; es una anulación (la fila y su auditoría quedan) y deja de contar', async () => {
    const created = await postCollection(employee, { goodEggsCount: 4, brokenEggsCount: 0 });
    const id = created.body.collection.id as string;
    const before = await getSummary(employee);

    expect((await voidCollection(employee, id)).status).toBe(403);
    const [a, b] = await Promise.all([voidCollection(admin, id), voidCollection(admin, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const row = await prisma.eggCollection.findUniqueOrThrow({ where: { id } });
    expect(row.voidedAt).not.toBeNull();
    expect(row.voidedByUserId).toBe(admin.userId);
    expect(
      await prisma.auditLog.count({
        where: { entityId: id, action: 'chicken_coop.collection_voided' },
      }),
    ).toBe(1);

    const after = await getSummary(employee);
    expect(before.body.today.goodEggs - after.body.today.goodEggs).toBe(4);
    const history = await request(app)
      .get('/api/v1/chicken-coop/collections?pageSize=31')
      .set(as(employee));
    const ids = history.body.days.flatMap((day: { collections: { id: string }[] }) =>
      day.collections.map((collection) => collection.id),
    );
    expect(ids).not.toContain(id);
    expect((await voidCollection(admin, crypto.randomUUID())).status).toBe(404);
  });
});
