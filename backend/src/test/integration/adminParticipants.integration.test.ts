import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Administradores como participantes de una actividad, contra Neon real
 * (`demo`) por HTTP real. Personas sintéticas: «Benja» (ADMIN de la sesión,
 * sin ficha), «Viki» (otra ADMIN sin ficha), un homónimo de Viki (otro ADMIN
 * con el MISMO nombre), un ADMIN con ficha de empleado, un ADMIN suspendido y
 * un EMPLOYEE. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-part-<RUN>`; los reportes se
 *    filtran SIEMPRE por la categoría sintética y las recolecciones usan una
 *    fecha de 2001 (nunca se leen ni afirman cifras reales);
 *  - nunca se edita ninguna fila preexistente;
 *  - `afterAll` borra solo lo creado (por id) y verifica conteos globales
 *    idénticos a los iniciales.
 */

const RUN = `test-part-${Date.now()}`;
const BENJA = `Benja sintético ${RUN}`;
const VIKI = `Viki sintética ${RUN}`;
const EMPLOYEE_NAME = `Persona sintética ${RUN}`;
const LINKED_NAME = `Admin con ficha ${RUN}`;
const COLLECTION_DATE = '2001-01-05';

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let benja: Actor;
let viki: Actor;
let vikiNamesake: Actor;
let linkedAdmin: Actor;
let suspended: Actor;
let employee: Actor;
let employeeId = '';
let linkedEmployeeId = '';
let categoryId = '';
let itemId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
const collectionIds: string[] = [];
const extraAuditIds: string[] = [];
let baseline: Record<string, number>;

async function globalCounts() {
  return {
    categories: await prisma.stockCategory.count(),
    items: await prisma.stockItem.count(),
    movements: await prisma.stockMovement.count(),
    collections: await prisma.eggCollection.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    profiles: await prisma.userProfile.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
  };
}

async function createEmployee(suffix: string, displayName: string) {
  const row = await prisma.employee.create({
    data: { code: `${RUN}-${suffix}`, displayName, role: 'Test', colorHex: '#4a7c59' },
    select: { id: true },
  });
  employeeIds.push(row.id);
  return row.id;
}

async function createActor(
  role: 'ADMIN' | 'EMPLOYEE',
  suffix: string,
  options: { linked?: string; displayName?: string; status?: 'ACTIVE' | 'SUSPENDED' } = {},
) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: options.status ?? 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId: options.linked,
      ...(options.displayName
        ? { personalProfile: { create: { displayName: options.displayName } } }
        : {}),
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
const today = () => formatLocalDate(toLocalDate(new Date(), config.businessTimeZone));
const key = () => crypto.randomUUID().replace(/-/g, '');

function postMovement(actor: Actor, body: object) {
  return request(app)
    .post(`/api/v1/stock/items/${itemId}/movements`)
    .set(as(actor))
    .set('Idempotency-Key', key())
    .send({ type: 'CONSUMPTION', quantity: '1', ...body });
}

async function postCollection(actor: Actor, body: object) {
  const response = await request(app)
    .post('/api/v1/chicken-coop/collections')
    .set(as(actor))
    .set('Idempotency-Key', key())
    .send({ goodEggsCount: 3, brokenEggsCount: 0, collectionDate: COLLECTION_DATE, ...body });
  if (response.body?.collection?.id) collectionIds.push(response.body.collection.id);
  return response;
}

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  categoryId = (
    await prisma.stockCategory.create({ data: { name: RUN, area: 'HOUSE' }, select: { id: true } })
  ).id;
  itemId = (
    await prisma.stockItem.create({
      data: {
        name: `${RUN}-bolsas-de-basura`,
        area: 'HOUSE',
        categoryId,
        unit: 'u',
        minimumQuantity: new Prisma.Decimal('1'),
        currentQuantity: new Prisma.Decimal('50'),
      },
      select: { id: true },
    })
  ).id;
  employeeId = await createEmployee('emp', EMPLOYEE_NAME);
  linkedEmployeeId = await createEmployee('linked', LINKED_NAME);
  benja = await createActor('ADMIN', 'benja', { displayName: BENJA });
  viki = await createActor('ADMIN', 'viki', { displayName: VIKI });
  vikiNamesake = await createActor('ADMIN', 'viki-2', { displayName: VIKI });
  linkedAdmin = await createActor('ADMIN', 'linked', { linked: linkedEmployeeId });
  suspended = await createActor('ADMIN', 'suspended', {
    displayName: `Suspendido ${RUN}`,
    status: 'SUSPENDED',
  });
  employee = await createActor('EMPLOYEE', 'emp', { linked: employeeId });
}, 60_000);

afterAll(async () => {
  const movementIds = (
    await prisma.stockMovement.findMany({ where: { stockItemId: itemId }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { id: { in: extraAuditIds } },
        { actorUserId: { in: userIds } },
        { entityId: { in: [...movementIds, ...collectionIds, itemId, categoryId] } },
      ],
    },
  });
  // Primero lo que referencia a los usuarios (FK RESTRICT del participante).
  await prisma.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
  await prisma.eggCollection.deleteMany({ where: { id: { in: collectionIds } } });
  await prisma.stockItem.deleteMany({ where: { id: itemId } });
  await prisma.stockCategory.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-part-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-part-' } } })).toBe(0);
  expect(
    await prisma.eggCollection.count({
      where: { collectionDate: new Date(`${COLLECTION_DATE}T00:00:00Z`) },
    }),
  ).toBe(0);
}, 60_000);

type Person = { displayName: string } | null;
type Row = { id: string; employee: Person; participantUser: Person; recordedBy: Person };
const who = (row: Row) => row.employee?.displayName ?? row.participantUser?.displayName ?? null;

describe('catálogo de participantes', () => {
  it('empleados y administradores activos, cada persona una sola vez', async () => {
    const response = await request(app).get('/api/v1/participants').set(as(employee));
    expect(response.status).toBe(200);
    const list = response.body.participants as { kind: string; id: string; displayName: string }[];
    const mine = list.filter((row) => row.displayName.includes(RUN));
    expect(mine).toEqual(
      expect.arrayContaining([
        { kind: 'ADMIN', id: benja.userId, displayName: BENJA, colorHex: null },
        { kind: 'ADMIN', id: viki.userId, displayName: VIKI, colorHex: null },
        { kind: 'ADMIN', id: vikiNamesake.userId, displayName: VIKI, colorHex: null },
        { kind: 'EMPLOYEE', id: employeeId, displayName: EMPLOYEE_NAME, colorHex: '#4a7c59' },
        // El ADMIN con ficha aparece UNA vez, por su empleado.
        { kind: 'EMPLOYEE', id: linkedEmployeeId, displayName: LINKED_NAME, colorHex: '#4a7c59' },
      ]),
    );
    expect(mine).toHaveLength(5);
    expect(list.some((row) => row.id === linkedAdmin.userId)).toBe(false);
    expect(list.some((row) => row.id === suspended.userId)).toBe(false);
    expect(list.some((row) => row.id === employee.userId)).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain(`${RUN}-benja`);
  });
});

describe('Stock — Benja registra que Viki consumió', () => {
  let vikiMovement = '';
  let selfMovement = '';
  let employeeMovement = '';
  let ownMovement = '';
  let namesakeMovement = '';
  let legacyMovement = '';

  it('participante y autor quedan guardados por separado', async () => {
    const response = await postMovement(benja, { participantUserId: viki.userId });
    expect(response.status).toBe(201);
    vikiMovement = response.body.movement.id;
    expect(response.body.movement).toMatchObject({
      employee: null,
      participantUser: { id: viki.userId, displayName: VIKI },
      recordedBy: { displayName: BENJA },
    });
    const stored = await prisma.stockMovement.findUniqueOrThrow({ where: { id: vikiMovement } });
    expect(stored).toMatchObject({ employeeId: null, participantUserId: viki.userId });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: vikiMovement, action: 'stock.movement.created' },
    });
    expect(audit.actorUserId).toBe(benja.userId);
  }, 60_000);

  it('un ADMIN se elige a sí mismo y elige empleados; EMPLOYEE conserva lo suyo', async () => {
    const self = await postMovement(benja, { participantUserId: benja.userId });
    const onBehalf = await postMovement(benja, { employeeId });
    const own = await postMovement(employee, {});
    const namesake = await postMovement(benja, { participantUserId: vikiNamesake.userId });
    expect([self.status, onBehalf.status, own.status, namesake.status]).toEqual([
      201, 201, 201, 201,
    ]);
    selfMovement = self.body.movement.id;
    employeeMovement = onBehalf.body.movement.id;
    ownMovement = own.body.movement.id;
    namesakeMovement = namesake.body.movement.id;
    expect(self.body.movement.recordedBy).toBeNull();
    expect(onBehalf.body.movement).toMatchObject({
      employee: { id: employeeId },
      participantUser: null,
      recordedBy: { displayName: BENJA },
    });
    expect(own.body.movement).toMatchObject({ employee: { id: employeeId }, recordedBy: null });
  }, 60_000);

  it('el backend rechaza selecciones inválidas o no permitidas sin escribir', async () => {
    const before = await prisma.stockMovement.count({ where: { stockItemId: itemId } });
    const cases = [
      [employee, { participantUserId: viki.userId }, 403],
      [benja, { participantUserId: suspended.userId }, 400],
      [benja, { participantUserId: linkedAdmin.userId }, 400],
      [benja, { participantUserId: employee.userId }, 400],
      [benja, { participantUserId: crypto.randomUUID() }, 400],
      [benja, { participantUserId: viki.userId, employeeId }, 400],
    ] as const;
    for (const [actor, body, status] of cases) {
      expect((await postMovement(actor, body)).status).toBe(status);
    }
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(before);
  }, 60_000);

  it('la base impide dos personas en el mismo movimiento (CHECK)', async () => {
    await expect(
      prisma.stockMovement.create({
        data: {
          stockItemId: itemId,
          type: 'INCOME',
          quantity: 1,
          effectiveDate: new Date(`${today()}T00:00:00.000Z`),
          employeeId,
          participantUserId: viki.userId,
        },
      }),
    ).rejects.toThrow();
  }, 60_000);

  it('un movimiento anterior (sin persona, con auditoría) sigue mostrando a su autor', async () => {
    legacyMovement = (
      await prisma.stockMovement.create({
        data: {
          stockItemId: itemId,
          type: 'CONSUMPTION',
          quantity: 1,
          effectiveDate: new Date(`${today()}T00:00:00.000Z`),
        },
        select: { id: true },
      })
    ).id;
    const audit = await prisma.auditLog.create({
      data: {
        actorUserId: benja.userId,
        action: 'stock.movement.created',
        entityType: 'StockMovement',
        entityId: legacyMovement,
      },
      select: { id: true },
    });
    extraAuditIds.push(audit.id);
  }, 60_000);

  it('historial, reporte, filtros, agrupación y CSV reflejan al participante desde cualquier sesión', async () => {
    const expected = new Map<string, [string | null, string | null]>([
      [vikiMovement, [VIKI, BENJA]],
      [selfMovement, [BENJA, null]],
      [employeeMovement, [EMPLOYEE_NAME, BENJA]],
      [ownMovement, [EMPLOYEE_NAME, null]],
      [namesakeMovement, [VIKI, BENJA]],
      [legacyMovement, [null, BENJA]],
    ]);
    const query = `from=${today()}&to=${today()}&categoryId=${categoryId}`;
    for (const viewer of [viki, employee]) {
      const history = await request(app)
        .get(`/api/v1/stock/items/${itemId}/movements?pageSize=50`)
        .set(as(viewer));
      const page = await request(app)
        .get(`/api/v1/stock/reports/movements?${query}&pageSize=50`)
        .set(as(viewer));
      for (const response of [history, page]) {
        expect(response.status).toBe(200);
        const rows = response.body.movements as Row[];
        expect(rows).toHaveLength(expected.size);
        for (const [id, [participant, recorder]] of expected) {
          const row = rows.find((candidate) => candidate.id === id)!;
          expect([who(row), row.recordedBy?.displayName ?? null]).toEqual([participant, recorder]);
        }
      }
    }

    // Filtro por administrador: solo Viki (no su homónimo, no lo que registró Benja).
    const filtered = await request(app)
      .get(`/api/v1/stock/reports/movements?${query}&participantUserId=${viki.userId}`)
      .set(as(employee));
    expect((filtered.body.movements as Row[]).map((row) => row.id)).toEqual([vikiMovement]);
    const byEmployee = await request(app)
      .get(`/api/v1/stock/reports/movements?${query}&employeeId=${employeeId}`)
      .set(as(employee));
    expect((byEmployee.body.movements as Row[]).map((row) => row.id).sort()).toEqual(
      [employeeMovement, ownMovement].sort(),
    );
    const both = await request(app)
      .get(
        `/api/v1/stock/reports/movements?${query}&participantUserId=${viki.userId}&employeeId=${employeeId}`,
      )
      .set(as(employee));
    expect(both.status).toBe(400);

    // Agrupación por identidad: los dos «Viki» quedan en grupos distintos.
    const summary = await request(app)
      .get(`/api/v1/stock/reports/summary?${query}`)
      .set(as(employee));
    expect(summary.status).toBe(200);
    const groups = (
      summary.body.employees as {
        employee: { id: string } | null;
        participantUser: { id: string; displayName: string } | null;
        recordedBy: { displayName: string } | null;
        total: number;
      }[]
    ).map((group) => ({
      id: group.employee?.id ?? group.participantUser?.id ?? null,
      name: group.participantUser?.displayName ?? group.recordedBy?.displayName ?? null,
      total: group.total,
    }));
    expect(groups).toEqual(
      expect.arrayContaining([
        { id: viki.userId, name: VIKI, total: 1 },
        { id: vikiNamesake.userId, name: VIKI, total: 1 },
        { id: benja.userId, name: BENJA, total: 1 },
        { id: employeeId, name: null, total: 2 },
        { id: null, name: BENJA, total: 1 },
      ]),
    );
    expect(groups).toHaveLength(5);

    // CSV: «Persona» es quien consumió (o, sin persona, quien registró).
    const csv = await request(app)
      .get(`/api/v1/stock/reports/movements.csv?${query}`)
      .set(as(employee));
    expect(csv.status).toBe(200);
    const persons = csv.text
      .replace(/^\uFEFF/, '')
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[4]);
    expect([...persons].sort()).toEqual(
      [VIKI, BENJA, EMPLOYEE_NAME, EMPLOYEE_NAME, VIKI, BENJA].map((name) => `"${name}"`).sort(),
    );
    // Nunca un username técnico.
    for (const suffix of ['benja', 'viki', 'viki-2', 'linked', 'emp']) {
      expect(csv.text).not.toContain(`"${RUN}-${suffix}"`);
    }
  });
});

describe('Gallinero — Benja registra que Viki juntó', () => {
  it('participante y autor por separado; historial igual desde otra sesión', async () => {
    const byViki = await postCollection(benja, { participantUserId: viki.userId });
    const self = await postCollection(benja, { participantUserId: benja.userId });
    const onBehalf = await postCollection(benja, { employeeId });
    const own = await postCollection(employee, {});
    expect([byViki.status, self.status, onBehalf.status, own.status]).toEqual([201, 201, 201, 201]);
    expect(byViki.body.collection).toMatchObject({
      employee: null,
      participantUser: { id: viki.userId, displayName: VIKI },
      recordedBy: { displayName: BENJA },
    });
    const stored = await prisma.eggCollection.findUniqueOrThrow({
      where: { id: byViki.body.collection.id },
    });
    expect(stored).toMatchObject({
      employeeId: null,
      participantUserId: viki.userId,
      recordedByUserId: benja.userId,
    });

    const expected = new Map<string, [string | null, string | null]>([
      [byViki.body.collection.id, [VIKI, BENJA]],
      [self.body.collection.id, [BENJA, null]],
      [onBehalf.body.collection.id, [EMPLOYEE_NAME, BENJA]],
      [own.body.collection.id, [EMPLOYEE_NAME, null]],
    ]);
    for (const viewer of [viki, employee]) {
      const history = await request(app)
        .get('/api/v1/chicken-coop/collections?pageSize=31')
        .set(as(viewer));
      expect(history.status).toBe(200);
      let rows: Row[] = [];
      for (let page = 1; page <= history.body.totalPages; page += 1) {
        const response =
          page === 1
            ? history
            : await request(app)
                .get(`/api/v1/chicken-coop/collections?pageSize=31&page=${page}`)
                .set(as(viewer));
        rows = rows.concat(
          (response.body.days as { collections: Row[] }[]).flatMap((day) => day.collections),
        );
      }
      for (const [id, [participant, recorder]] of expected) {
        const row = rows.find((candidate) => candidate.id === id)!;
        expect([who(row), row.recordedBy?.displayName ?? null]).toEqual([participant, recorder]);
      }
    }
  }, 60_000);

  it('rechaza selecciones inválidas y EMPLOYEE conserva sus permisos', async () => {
    const before = await prisma.eggCollection.count();
    expect((await postCollection(employee, { participantUserId: viki.userId })).status).toBe(403);
    for (const target of [suspended, linkedAdmin, employee]) {
      const response = await postCollection(benja, { participantUserId: target.userId });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('EGG_COLLECTOR_INVALID');
    }
    expect(
      (await postCollection(benja, { participantUserId: viki.userId, employeeId })).status,
    ).toBe(400);
    expect(await prisma.eggCollection.count()).toBe(before);
  });
});
