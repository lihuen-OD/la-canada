import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

/**
 * Reglas del servicio de Gallinero con un Prisma simulado mínimo: permisos,
 * "¿Quién juntó?", fechas de negocio, actualización condicional y
 * anulación. La SQL real (GROUP BY, CHECK, índices, concurrencia) se prueba
 * contra `demo` en `chickenCoop.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  const client = {
    chickenCoop: { findUnique: fn(), create: fn(), updateMany: fn() },
    eggCollection: {
      create: fn(),
      findUnique: fn(),
      updateMany: fn(),
      groupBy: fn(),
      findMany: fn(),
    },
    employee: { findUnique: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
  return client;
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  adjustChickenCoopHens,
  configureChickenCoop,
  createEggCollection,
  getChickenCoopSummary,
  voidEggCollection,
  type ChickenCoopActor,
} from '../../chickenCoop/chickenCoopService';

const META = { ipAddress: '127.0.0.1', userAgent: 'vitest' };
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const COLLECTION_ID = '44444444-4444-4444-8444-444444444444';
const EMPLOYEE: ChickenCoopActor = { userId: 'user-e', role: 'EMPLOYEE', employeeId: EMPLOYEE_ID };
const ADMIN: ChickenCoopActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
/** 23:30 del 25/09 en Buenos Aires = 02:30 UTC del 26/09. */
const NOW = new Date('2026-09-26T02:30:00Z');

function collectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COLLECTION_ID,
    collectionDate: new Date('2026-09-25T00:00:00Z'),
    goodEggsCount: 5,
    brokenEggsCount: 1,
    notes: null,
    createdAt: new Date('2026-09-26T02:30:00Z'),
    employee: { id: EMPLOYEE_ID, displayName: 'Persona', colorHex: null },
    ...overrides,
  };
}

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.chickenCoop.findUnique.mockResolvedValue(null);
  db.eggCollection.create.mockResolvedValue(collectionRow());
  db.auditLog.create.mockResolvedValue({});
});

describe('permisos ADMIN (paridad con admin-only del prototipo)', () => {
  it.each([
    ['configurar', () => configureChickenCoop(EMPLOYEE, { activeHensCount: 3 }, META)],
    ['alta/baja', () => adjustChickenCoopHens(EMPLOYEE, { delta: 1, expectedCount: 3 }, META)],
    ['eliminar recolección', () => voidEggCollection(EMPLOYEE, COLLECTION_ID, META)],
  ])('EMPLOYEE no puede %s y no se toca la base', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403, code: 'AUTH_FORBIDDEN' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('registrar recolección', () => {
  it('EMPLOYEE: persona = su sesión, actor real = su usuario, fecha de hoy en BUSINESS_TIME_ZONE', async () => {
    const result = await createEggCollection(
      EMPLOYEE,
      { goodEggsCount: 5, brokenEggsCount: 1 },
      META,
      NOW,
    );
    expect(result.kind).toBe('created');
    const data = db.eggCollection.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      employeeId: EMPLOYEE_ID,
      recordedByUserId: 'user-e',
      chickenCoopId: null,
      goodEggsCount: 5,
      brokenEggsCount: 1,
      notes: null,
    });
    expect(data.collectionDate.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      actorUserId: 'user-e',
      action: 'chicken_coop.collection_created',
      entityType: 'EggCollection',
    });
  });

  it('vincula la recolección al gallinero "main" si ya está configurado', async () => {
    db.chickenCoop.findUnique.mockResolvedValue({
      id: 'coop-1',
      activeHensCount: 4,
      updatedAt: NOW,
    });
    await createEggCollection(EMPLOYEE, { goodEggsCount: 1, brokenEggsCount: 0 }, META, NOW);
    expect(db.chickenCoop.findUnique.mock.calls[0]?.[0]).toMatchObject({ where: { code: 'main' } });
    expect(db.eggCollection.create.mock.calls[0]?.[0].data.chickenCoopId).toBe('coop-1');
  });

  it('EMPLOYEE no puede registrar a nombre de otra persona', async () => {
    await expect(
      createEggCollection(
        EMPLOYEE,
        { goodEggsCount: 1, brokenEggsCount: 0, employeeId: OTHER_EMPLOYEE_ID },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('EMPLOYEE sin empleado activo vinculado → 409 EMPLOYEE_LINK_REQUIRED', async () => {
    await expect(
      createEggCollection(
        { ...EMPLOYEE, employeeId: null },
        { goodEggsCount: 1, brokenEggsCount: 0 },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_LINK_REQUIRED' });
  });

  it('ADMIN sin empleado vinculado debe elegir quién juntó', async () => {
    await expect(
      createEggCollection(ADMIN, { goodEggsCount: 1, brokenEggsCount: 0 }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Elegí quién juntó los huevos.' });
  });

  it('ADMIN elige un empleado activo: persona elegida, actor real el ADMIN', async () => {
    db.employee.findUnique.mockResolvedValue({ active: true });
    await createEggCollection(
      ADMIN,
      { goodEggsCount: 2, brokenEggsCount: 0, employeeId: OTHER_EMPLOYEE_ID.toUpperCase() },
      META,
      NOW,
    );
    expect(db.eggCollection.create.mock.calls[0]?.[0].data).toMatchObject({
      employeeId: OTHER_EMPLOYEE_ID,
      recordedByUserId: 'user-a',
    });
  });

  it('ADMIN con un empleado inexistente o inactivo → 400 sin escribir', async () => {
    db.employee.findUnique.mockResolvedValue({ active: false });
    await expect(
      createEggCollection(
        ADMIN,
        { goodEggsCount: 2, brokenEggsCount: 0, employeeId: OTHER_EMPLOYEE_ID },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'EGG_COLLECTOR_INVALID' });
    expect(db.eggCollection.create).not.toHaveBeenCalled();
  });

  it('fecha pasada permitida; futura rechazada según el día de BUSINESS_TIME_ZONE (no UTC)', async () => {
    await createEggCollection(
      EMPLOYEE,
      { goodEggsCount: 1, brokenEggsCount: 0, collectionDate: '2026-09-01' },
      META,
      NOW,
    );
    expect(db.eggCollection.create).toHaveBeenCalledTimes(1);
    // En UTC ya es 26/09, pero en Buenos Aires sigue siendo 25/09.
    await expect(
      createEggCollection(
        EMPLOYEE,
        { goodEggsCount: 1, brokenEggsCount: 0, collectionDate: '2026-09-26' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      createEggCollection(
        EMPLOYEE,
        { goodEggsCount: 1, brokenEggsCount: 0, collectionDate: '2026-02-30' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400, message: 'La fecha no es válida.' });
  });

  it('una clave Idempotency-Key mal formada se rechaza antes de escribir', async () => {
    await expect(
      createEggCollection(EMPLOYEE, { goodEggsCount: 1, brokenEggsCount: 0 }, META, NOW, 'x'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID' });
    expect(db.eggCollection.create).not.toHaveBeenCalled();
  });
});

describe('eliminar (anular) recolección', () => {
  it('anula con updateMany condicionado a voidedAt null y audita; nunca borra', async () => {
    db.eggCollection.findUnique.mockResolvedValue({ ...collectionRow(), voidedAt: null });
    db.eggCollection.updateMany.mockResolvedValue({ count: 1 });
    const result = await voidEggCollection(ADMIN, COLLECTION_ID, META, NOW);
    expect(db.eggCollection.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: COLLECTION_ID, voidedAt: null },
      data: { voidedAt: NOW, voidedByUserId: 'user-a' },
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      action: 'chicken_coop.collection_voided',
      newState: { voided: true },
    });
    expect(result).toEqual({ collection: { id: COLLECTION_ID, voidedAt: NOW.toISOString() } });
  });

  it('inexistente → 404; ya anulada (o anulación simultánea) → 409', async () => {
    db.eggCollection.findUnique.mockResolvedValue(null);
    await expect(voidEggCollection(ADMIN, COLLECTION_ID, META)).rejects.toMatchObject({
      statusCode: 404,
    });
    db.eggCollection.findUnique.mockResolvedValue({ ...collectionRow(), voidedAt: NOW });
    db.eggCollection.updateMany.mockResolvedValue({ count: 0 });
    await expect(voidEggCollection(ADMIN, COLLECTION_ID, META)).rejects.toMatchObject({
      code: 'EGG_COLLECTION_ALREADY_VOIDED',
    });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('gallinas activas', () => {
  it('configuración inicial con code "main"; una segunda configuración → 409', async () => {
    db.chickenCoop.create.mockResolvedValue({ id: 'coop-1', activeHensCount: 12, updatedAt: NOW });
    const result = await configureChickenCoop(ADMIN, { activeHensCount: 12 }, META);
    expect(db.chickenCoop.create.mock.calls[0]?.[0].data).toEqual({
      code: 'main',
      activeHensCount: 12,
    });
    expect(result.coop).toEqual({
      configured: true,
      activeHensCount: 12,
      updatedAt: NOW.toISOString(),
    });

    db.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(configureChickenCoop(ADMIN, { activeHensCount: 3 }, META)).rejects.toMatchObject({
      code: 'CHICKEN_COOP_ALREADY_CONFIGURED',
    });
  });

  it('alta/baja condicionada a la cantidad confirmada', async () => {
    db.chickenCoop.updateMany.mockResolvedValue({ count: 1 });
    db.chickenCoop.findUnique.mockResolvedValue({
      id: 'coop-1',
      activeHensCount: 4,
      updatedAt: NOW,
    });
    await adjustChickenCoopHens(ADMIN, { delta: -1, expectedCount: 5 }, META);
    expect(db.chickenCoop.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { code: 'main', activeHensCount: 5 },
      data: { activeHensCount: 4 },
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      action: 'chicken_coop.hens_adjusted',
      previousState: { activeHensCount: 5 },
      newState: { activeHensCount: 4, delta: -1 },
    });
  });

  it('cantidad cambiada mientras tanto → 409 sin aplicar; sin configurar → 409 pendiente', async () => {
    db.chickenCoop.updateMany.mockResolvedValue({ count: 0 });
    db.chickenCoop.findUnique.mockResolvedValue({
      id: 'coop-1',
      activeHensCount: 7,
      updatedAt: NOW,
    });
    await expect(
      adjustChickenCoopHens(ADMIN, { delta: 1, expectedCount: 5 }, META),
    ).rejects.toMatchObject({ code: 'CHICKEN_COOP_COUNT_CHANGED' });
    db.chickenCoop.findUnique.mockResolvedValue(null);
    await expect(
      adjustChickenCoopHens(ADMIN, { delta: 1, expectedCount: 5 }, META),
    ).rejects.toMatchObject({ code: 'CHICKEN_COOP_NOT_CONFIGURED' });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('una baja con 0 gallinas se rechaza antes de tocar la base (nunca negativo)', async () => {
    await expect(
      adjustChickenCoopHens(ADMIN, { delta: -1, expectedCount: 0 }, META),
    ).rejects.toMatchObject({ code: 'CHICKEN_COOP_COUNT_LIMIT' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe('resumen', () => {
  it('sin configuración: coop.configured=false y posturas null; lee con GROUP BY por fecha, sin anuladas', async () => {
    db.eggCollection.groupBy.mockResolvedValue([
      {
        collectionDate: new Date('2026-09-25T00:00:00Z'),
        _sum: { goodEggsCount: 6, brokenEggsCount: 1 },
      },
    ]);
    const summary = await getChickenCoopSummary(EMPLOYEE, { days: 7 }, NOW);
    expect(summary.coop).toEqual({ configured: false, activeHensCount: null, updatedAt: null });
    expect(summary.today).toEqual({
      date: '2026-09-25',
      goodEggs: 6,
      brokenEggs: 1,
      layingRate: null,
    });
    const where = db.eggCollection.groupBy.mock.calls[0]?.[0].where;
    expect(where.voidedAt).toBeNull();
    expect(where.collectionDate.gte.toISOString()).toBe('2026-09-19T00:00:00.000Z');
    expect(where.collectionDate.lte.toISOString()).toBe('2026-09-25T00:00:00.000Z');
  });
});
