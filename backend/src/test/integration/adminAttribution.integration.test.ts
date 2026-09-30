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
 * Identificación de administradores en los registros, contra Neon real
 * (`demo`) por HTTP real: dos ADMIN sintéticos sin `Employee` y con nombres
 * distintos en Mi perfil, más un EMPLOYEE sintético. Cubre la SQL real de
 * Stock (historial del producto, reportes, agrupación por persona y CSV) y
 * del historial clínico de Mascotas. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-attr-<RUN>`; los reportes se
 *    filtran SIEMPRE por la categoría sintética (nunca se leen datos reales);
 *  - nunca se edita ninguna fila preexistente;
 *  - `afterAll` borra solo lo creado (por id) y verifica conteos globales
 *    idénticos a los iniciales.
 */

const RUN = `test-attr-${Date.now()}`;
const NAME_A = `Admin sintética Uno ${RUN}`;
const NAME_B = `Admin sintético Dos ${RUN}`;
const EMPLOYEE_NAME = `Persona sintética ${RUN}`;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let adminA: Actor;
let adminB: Actor;
let employee: Actor;
let employeeId = '';
let categoryId = '';
let itemId = '';
let animalTypeId = '';
let petId = '';
const userIds: string[] = [];
const extraAuditIds: string[] = [];
let baseline: Record<string, number>;

async function globalCounts() {
  return {
    categories: await prisma.stockCategory.count(),
    items: await prisma.stockItem.count(),
    movements: await prisma.stockMovement.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    profiles: await prisma.userProfile.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
    animalTypes: await prisma.animalType.count(),
    animals: await prisma.animal.count(),
    records: await prisma.animalMedicalRecord.count(),
  };
}

async function createActor(
  role: 'ADMIN' | 'EMPLOYEE',
  suffix: string,
  options: { linked?: string; displayName?: string } = {},
) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
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
const browserKey = () => crypto.randomUUID().replace(/-/g, '');

async function postMovement(actor: Actor, body: object) {
  const response = await request(app)
    .post(`/api/v1/stock/items/${itemId}/movements`)
    .set(as(actor))
    .set('Idempotency-Key', browserKey())
    .send(body);
  expect(response.status).toBe(201);
  return response.body.movement as { id: string; recordedBy: unknown; employee: unknown };
}

const reportQuery = () => `from=${today()}&to=${today()}&categoryId=${categoryId}`;

let byA = '';
let byB = '';
let onBehalf = '';
let own = '';
let legacyWithAudit = '';
let legacyWithoutAudit = '';
let laterByB = '';

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  categoryId = (
    await prisma.stockCategory.create({ data: { name: RUN, area: 'GARDEN' }, select: { id: true } })
  ).id;
  itemId = (
    await prisma.stockItem.create({
      data: {
        name: `${RUN}-fertilizante`,
        area: 'GARDEN',
        categoryId,
        unit: 'kg',
        minimumQuantity: new Prisma.Decimal('1'),
        currentQuantity: new Prisma.Decimal('20'),
      },
      select: { id: true },
    })
  ).id;
  employeeId = (
    await prisma.employee.create({
      data: { code: `${RUN}-emp`, displayName: EMPLOYEE_NAME, role: 'Test', colorHex: '#4a7c59' },
      select: { id: true },
    })
  ).id;
  adminA = await createActor('ADMIN', 'admin-a', { displayName: NAME_A });
  adminB = await createActor('ADMIN', 'admin-b', { displayName: NAME_B });
  employee = await createActor('EMPLOYEE', 'emp', { linked: employeeId });
  animalTypeId = (
    await prisma.animalType.create({ data: { name: `${RUN}-tipo` }, select: { id: true } })
  ).id;
  petId = (
    await prisma.animal.create({
      data: { name: `${RUN}-mascota`, animalTypeId },
      select: { id: true },
    })
  ).id;

  byA = (await postMovement(adminA, { type: 'INCOME', quantity: '3', employeeId: null })).id;
  byB = (await postMovement(adminB, { type: 'CONSUMPTION', quantity: '1', employeeId: null })).id;
  onBehalf = (await postMovement(adminA, { type: 'CONSUMPTION', quantity: '1', employeeId })).id;
  own = (await postMovement(employee, { type: 'INCOME', quantity: '2' })).id;

  // Registros "anteriores" a esta corrección, sin columna de autor: uno con su
  // auditoría de alta (evidencia) y otro sin ninguna (como las aperturas).
  const effectiveDate = new Date(`${today()}T00:00:00.000Z`);
  legacyWithAudit = (
    await prisma.stockMovement.create({
      data: { stockItemId: itemId, type: 'INCOME', quantity: 1, effectiveDate },
      select: { id: true },
    })
  ).id;
  const audit = await prisma.auditLog.create({
    data: {
      actorUserId: adminB.userId,
      action: 'stock.movement.created',
      entityType: 'StockMovement',
      entityId: legacyWithAudit,
    },
    select: { id: true },
  });
  extraAuditIds.push(audit.id);
  legacyWithoutAudit = (
    await prisma.stockMovement.create({
      data: { stockItemId: itemId, type: 'INCOME', quantity: 1, effectiveDate },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  const movementIds = (
    await prisma.stockMovement.findMany({ where: { stockItemId: itemId }, select: { id: true } })
  ).map((row) => row.id);
  const recordIds = (
    await prisma.animalMedicalRecord.findMany({ where: { animalId: petId }, select: { id: true } })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { id: { in: extraAuditIds } },
        { actorUserId: { in: userIds } },
        { entityId: { in: [...movementIds, ...recordIds, itemId, categoryId, petId] } },
      ],
    },
  });
  await prisma.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
  await prisma.stockItem.deleteMany({ where: { id: itemId } });
  await prisma.stockCategory.deleteMany({ where: { id: categoryId } });
  await prisma.animalMedicalRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.animal.deleteMany({ where: { id: petId } });
  await prisma.animalType.deleteMany({ where: { id: animalTypeId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-attr-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-attr-' } } })).toBe(0);
}, 60_000);

type Row = { id: string; employee: { displayName: string } | null; recordedBy: unknown };

/** Lo que muestra la pantalla: la persona asociada o, sin ella, quien registró. */
const shown = (row: Row) =>
  row.employee?.displayName ??
  (row.recordedBy as { displayName: string } | null)?.displayName ??
  null;

const expected = () =>
  new Map<string, string | null>([
    [byA, NAME_A],
    [byB, NAME_B],
    [onBehalf, EMPLOYEE_NAME],
    [own, EMPLOYEE_NAME],
    [legacyWithAudit, NAME_B],
    [legacyWithoutAudit, null],
    ...(laterByB ? ([[laterByB, NAME_B]] as const) : []),
  ]);

describe('Stock — cada movimiento muestra a quien corresponde', () => {
  it('el alta devuelve al administrador que registró (de la sesión, no del cuerpo)', async () => {
    const movement = await postMovement(adminB, {
      type: 'INCOME',
      quantity: '1',
      employeeId: null,
    });
    expect(movement.recordedBy).toEqual({ displayName: NAME_B });
    laterByB = movement.id;
  });

  it('historial del producto: misma atribución desde cualquier sesión', async () => {
    for (const viewer of [adminA, adminB, employee]) {
      const response = await request(app)
        .get(`/api/v1/stock/items/${itemId}/movements?pageSize=50`)
        .set(as(viewer));
      expect(response.status).toBe(200);
      const rows = response.body.movements as Row[];
      for (const [id, name] of expected()) {
        expect(shown(rows.find((row) => row.id === id)!)).toBe(name);
      }
      // Con persona asociada, la persona conserva su significado; como la cargó
      // otro usuario, el autor aparece aparte («Registró: …»).
      expect(rows.find((row) => row.id === onBehalf)!.recordedBy).toEqual({ displayName: NAME_A });
      expect(rows.find((row) => row.id === own)!.recordedBy).toBeNull();
      const text = JSON.stringify(response.body);
      expect(text).not.toContain(`${RUN}-admin`);
      expect(text).not.toContain(adminA.userId);
    }
  });

  it('reporte de movimientos y CSV coinciden con el historial', async () => {
    for (const viewer of [adminA, employee]) {
      const page = await request(app)
        .get(`/api/v1/stock/reports/movements?${reportQuery()}&pageSize=50`)
        .set(as(viewer));
      expect(page.status).toBe(200);
      const rows = page.body.movements as Row[];
      for (const [id, name] of expected()) {
        expect(shown(rows.find((row) => row.id === id)!)).toBe(name);
      }

      const csv = await request(app)
        .get(`/api/v1/stock/reports/movements.csv?${reportQuery()}`)
        .set(as(viewer));
      expect(csv.status).toBe(200);
      const persons = csv.text
        .replace(/^\uFEFF/, '')
        .split('\n')
        .slice(1)
        .map((line) => line.split(',')[4]);
      // Mismo multiconjunto de personas que el reporte (el CSV no lleva ids).
      const fromReport = rows.map((row) => `"${shown(row) ?? ''}"`);
      expect([...persons].sort()).toEqual([...fromReport].sort());
      expect(csv.text).not.toContain(`${RUN}-admin`);
    }
  });

  it('movimientos por persona: un grupo por administrador; lo que no tiene evidencia, aparte', async () => {
    const response = await request(app)
      .get(`/api/v1/stock/reports/summary?${reportQuery()}`)
      .set(as(employee));
    expect(response.status).toBe(200);
    const groups = response.body.employees as {
      employee: { displayName: string } | null;
      recordedBy: { displayName: string } | null;
      total: number;
    }[];
    const byName = new Map(
      groups.map((group) => [
        group.employee?.displayName ?? group.recordedBy?.displayName ?? null,
        group.total,
      ]),
    );
    const counts = new Map<string | null, number>();
    for (const name of expected().values()) counts.set(name, (counts.get(name) ?? 0) + 1);
    expect(byName).toEqual(counts);
  });
});

describe('Mascotas — historial clínico', () => {
  it('sin persona, cada registro muestra al ADMIN que lo cargó; el empleado conserva el suyo', async () => {
    const post = (actor: Actor, description: string) =>
      request(app)
        .post(`/api/v1/pets/${petId}/records`)
        .set(as(actor))
        .send({ type: 'CHECKUP', recordDate: today(), description });
    const created = [
      await post(adminA, `${RUN} por A`),
      await post(adminB, `${RUN} por B`),
      await post(employee, `${RUN} por empleado`),
    ];
    expect(created.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(created[0]!.body.record.recordedBy).toEqual({ displayName: NAME_A });

    for (const viewer of [adminB, employee]) {
      const list = await request(app).get(`/api/v1/pets/${petId}/records`).set(as(viewer));
      expect(list.status).toBe(200);
      const byDescription = new Map(
        (list.body.records as (Row & { description: string })[]).map((row) => [
          row.description,
          shown(row),
        ]),
      );
      expect(byDescription.get(`${RUN} por A`)).toBe(NAME_A);
      expect(byDescription.get(`${RUN} por B`)).toBe(NAME_B);
      expect(byDescription.get(`${RUN} por empleado`)).toBe(EMPLOYEE_NAME);
    }
  });
});
