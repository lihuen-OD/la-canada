import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';

/**
 * Stock objetivo contra Neon real (`demo`) por HTTP real: la regla de niveles
 * en el SQL de Postgres (filtro y conteos), Compras, Inicio, el CHECK de la
 * base y la edición del objetivo. Reglas de datos:
 *  - todo lo creado lleva el prefijo `test-target-<RUN>`; listados y reportes
 *    se filtran SIEMPRE por la categoría sintética (Inicio se afirma solo
 *    sobre los ids sintéticos);
 *  - nunca se edita ninguna fila preexistente;
 *  - `afterAll` borra solo lo creado (por id) y verifica conteos globales
 *    idénticos a los iniciales.
 */

const RUN = `test-target-${Date.now()}`;

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let categoryId = '';
const userIds: string[] = [];
const itemIds: string[] = [];
const ids: Record<string, string> = {};
let baseline: Record<string, number>;

async function globalCounts() {
  return {
    categories: await prisma.stockCategory.count(),
    items: await prisma.stockItem.count(),
    movements: await prisma.stockMovement.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
  };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
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

/** Producto sintético con saldo directo (sin movimientos): solo para fijar niveles. */
async function createItem(
  key: string,
  current: string,
  minimum: string,
  target: string | null,
  active = true,
) {
  const row = await prisma.stockItem.create({
    data: {
      name: `${RUN}-${key}`,
      area: 'HOUSE',
      categoryId,
      unit: 'kg',
      minimumQuantity: new Prisma.Decimal(minimum),
      targetQuantity: target === null ? null : new Prisma.Decimal(target),
      currentQuantity: new Prisma.Decimal(current),
      active,
    },
    select: { id: true },
  });
  itemIds.push(row.id);
  ids[key] = row.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  categoryId = (
    await prisma.stockCategory.create({ data: { name: RUN, area: 'HOUSE' }, select: { id: true } })
  ).id;
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp');
  // Ejemplo acordado: mínimo 20, objetivo 50 → punto medio 35.
  await createItem('bajo-minimo', '19', '20', '50');
  await createItem('igual-minimo', '20', '20', '50');
  await createItem('punto-medio', '35', '20', '50');
  await createItem('sobre-medio', '35.01', '20', '50');
  await createItem('sobre-objetivo', '80', '20', '50');
  // Punto medio no entero: (3 + 8) / 2 = 5.5.
  await createItem('medio-decimal', '5.5', '3', '8');
  await createItem('medio-decimal-ok', '5.51', '3', '8');
  // Stock cero y mínimo cero.
  await createItem('cero-cero', '0', '0', '10');
  // Productos anteriores sin objetivo.
  await createItem('antiguo-pendiente', '25', '20', null);
  await createItem('antiguo-critico', '20', '20', null);
  // Inactivo y crítico: nunca en Compras ni en Inicio.
  await createItem('inactivo-critico', '0', '5', '10', false);
}, 60_000);

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorUserId: { in: userIds } }, { entityId: { in: [...itemIds, categoryId] } }],
    },
  });
  await prisma.stockItem.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.stockCategory.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.stockItem.count({ where: { name: { startsWith: 'test-target-' } } })).toBe(0);
}, 60_000);

const list = (actor: Actor, query: Record<string, string>) =>
  request(app)
    .get('/api/v1/stock/items')
    .set(as(actor))
    .query({ categoryId, pageSize: '100', ...query });

const idsOf = (body: { items: { id: string }[] }) => body.items.map((item) => item.id).sort();
const pick = (...keys: string[]) => keys.map((key) => ids[key]!).sort();

describe('niveles con stock objetivo — misma regla en Postgres y en el DTO', () => {
  it('el filtro por nivel coincide con los límites acordados, sin redondear el punto medio', async () => {
    const expected: Record<string, string[]> = {
      critical: ['bajo-minimo', 'igual-minimo', 'cero-cero', 'antiguo-critico'],
      low: ['punto-medio', 'medio-decimal'],
      ok: ['sobre-medio', 'sobre-objetivo', 'medio-decimal-ok'],
      pending: ['antiguo-pendiente'],
    };
    for (const [level, keys] of Object.entries(expected)) {
      const response = await list(employee, { stockLevel: level, status: 'active' });
      expect(response.status).toBe(200);
      expect(idsOf(response.body)).toEqual(pick(...keys));
      expect(
        response.body.items.every((item: { stockLevel: string }) => item.stockLevel === level),
      ).toBe(true);
    }
  });

  it('DTO: objetivo, cantidad sugerida exacta y «pendiente» sin inventar valores', async () => {
    // `status=all` es de ADMIN (regla existente); el DTO es el mismo para todos.
    const response = await list(admin, { status: 'all' });
    const byId = new Map(
      (response.body.items as Record<string, unknown>[]).map((item) => [item.id as string, item]),
    );
    expect(byId.get(ids['bajo-minimo']!)).toMatchObject({
      minimumQuantity: '20',
      targetQuantity: '50',
      currentQuantity: '19',
      stockLevel: 'critical',
      suggestedPurchaseQuantity: '31',
    });
    expect(byId.get(ids['medio-decimal']!)).toMatchObject({ suggestedPurchaseQuantity: '2.5' });
    expect(byId.get(ids['sobre-objetivo']!)).toMatchObject({
      stockLevel: 'ok',
      suggestedPurchaseQuantity: '0',
    });
    expect(byId.get(ids['antiguo-critico']!)).toMatchObject({
      targetQuantity: null,
      stockLevel: 'critical',
      suggestedPurchaseQuantity: null,
    });
  });

  it('Compras (críticos activos) excluye bajos e inactivos', async () => {
    const response = await list(employee, {
      stockLevel: 'critical',
      status: 'active',
      sort: 'name',
    });
    expect(idsOf(response.body)).not.toContain(ids['inactivo-critico']);
    expect(idsOf(response.body)).not.toContain(ids['punto-medio']);
    // El inactivo conserva su nivel matemático (visible para ADMIN con status=all).
    const all = await list(admin, { stockLevel: 'critical', status: 'all' });
    expect(idsOf(all.body)).toContain(ids['inactivo-critico']);
  });

  it('reportes: «Estado actual» cuenta con la misma regla (solo activos), incluidos los pendientes', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const response = await request(app)
      .get('/api/v1/stock/reports/summary')
      .set(as(employee))
      .query({ from: today, to: today, categoryId });
    expect(response.status).toBe(200);
    expect(response.body.currentLevels).toMatchObject({ critical: 4, low: 2, ok: 3, pending: 1 });
  });

  it('Inicio muestra críticos (igual al mínimo incluido) y excluye bajos, pendientes e inactivos', async () => {
    const response = await request(app).get('/api/v1/dashboard').set(as(employee));
    expect(response.status).toBe(200);
    const alerts = (response.body.stockAlerts as { id: string; stockLevel: string }[]).filter(
      (alert) => itemIds.includes(alert.id),
    );
    expect(alerts.map((alert) => alert.id).sort()).toEqual(
      pick('bajo-minimo', 'igual-minimo', 'cero-cero', 'antiguo-critico'),
    );
    expect(alerts.every((alert) => alert.stockLevel === 'critical')).toBe(true);
  });
});

describe('alta y edición del objetivo', () => {
  const body = (overrides: Record<string, string>) => ({
    name: `${RUN}-nuevo`,
    area: 'HOUSE',
    categoryId,
    unit: 'u',
    minimumQuantity: '20',
    targetQuantity: '50',
    ...overrides,
  });

  it('un producto nuevo exige objetivo mayor que el mínimo; la base también lo impide', async () => {
    const withoutTarget: Record<string, unknown> = { ...body({}) };
    delete withoutTarget.targetQuantity;
    for (const payload of [
      withoutTarget,
      body({ targetQuantity: '20' }),
      body({ targetQuantity: '19.99' }),
    ]) {
      const response = await request(app).post('/api/v1/stock/items').set(as(admin)).send(payload);
      expect(response.status).toBe(400);
    }
    await expect(
      prisma.stockItem.create({
        data: {
          name: `${RUN}-check`,
          area: 'HOUSE',
          categoryId,
          unit: 'u',
          minimumQuantity: new Prisma.Decimal('5'),
          targetQuantity: new Prisma.Decimal('5'),
        },
      }),
    ).rejects.toThrow();
    const created = await request(app).post('/api/v1/stock/items').set(as(admin)).send(body({}));
    expect(created.status).toBe(201);
    itemIds.push(created.body.item.id);
    expect(created.body.item).toMatchObject({
      targetQuantity: '50',
      currentQuantity: '0',
      stockLevel: 'critical',
      suggestedPurchaseQuantity: '50',
    });
  });

  it('completar el objetivo de un producto antiguo recalcula su nivel y la cantidad sugerida', async () => {
    const itemId = ids['antiguo-critico']!;
    const response = await request(app)
      .patch(`/api/v1/stock/items/${itemId}`)
      .set(as(admin))
      .send({ targetQuantity: '44' });
    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({
      targetQuantity: '44',
      stockLevel: 'critical',
      suggestedPurchaseQuantity: '24',
    });
    // Cambiar el mínimo por encima del objetivo se rechaza sin escribir.
    const invalid = await request(app)
      .patch(`/api/v1/stock/items/${itemId}`)
      .set(as(admin))
      .send({ minimumQuantity: '44' });
    expect(invalid.status).toBe(400);
    const row = await prisma.stockItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(row.minimumQuantity.toString()).toBe('20');
    expect(row.targetQuantity?.toString()).toBe('44');
    // El saldo nunca cambió: la sugerencia no registra compras.
    expect(row.currentQuantity.toString()).toBe('20');
    expect(await prisma.stockMovement.count({ where: { stockItemId: itemId } })).toBe(0);
  });

  it('un producto antiguo se desactiva sin completar el objetivo; EMPLOYEE no edita', async () => {
    const itemId = ids['antiguo-pendiente']!;
    const off = await request(app)
      .patch(`/api/v1/stock/items/${itemId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.item).toMatchObject({ active: false, targetQuantity: null });
    const denied = await request(app)
      .patch(`/api/v1/stock/items/${itemId}`)
      .set(as(employee))
      .send({ targetQuantity: '60' });
    expect(denied.status).toBe(403);
  });
});
