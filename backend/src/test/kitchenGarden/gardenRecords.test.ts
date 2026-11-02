import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🥬 Huerta → 📝 Registros con Prisma simulado: agenda (vencidas, para hoy,
 * próximas, sin fecha), tipo opcional («Sin clasificar») y observaciones,
 * permisos de crear y editar (ADMIN y participantes activos, también lo de
 * otro responsable), versión con bloqueo de fila, ediciones sin cambios que
 * no escriben, tipo/observaciones que no versionan la planificación y la
 * siembra «Una vez» con su trasplante en una sola transacción. La SQL real
 * se prueba contra `demo` en la integración.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    kitchenGardenParticipant: { findMany: fn() },
    kitchenGardenActivity: { findMany: fn(), findUnique: fn(), create: fn(), update: fn() },
    kitchenGardenPlanningInterval: { create: fn(), updateMany: fn() },
    kitchenGardenExecution: { findMany: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { GARDEN_AGENDA_GROUPS, agendaOf, compareAgenda } from '../../kitchenGarden/gardenAgenda';
import {
  createGardenActivity,
  listGardenActivities,
  setGardenActivityActive,
  updateGardenActivity,
} from '../../kitchenGarden/gardenActivitiesService';
import {
  createGardenActivityBodySchema,
  updateGardenActivityBodySchema,
} from '../../kitchenGarden/gardenSchemas';

const META = { ipAddress: null, userAgent: 'vitest' };
// Lunes 2 de noviembre de 2026, 12:00 en Buenos Aires.
const NOW = new Date('2026-11-02T15:00:00.000Z');
const TODAY = '2026-11-02';
const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const ACTIVITY = '00000000-0000-4000-8000-0000000000b1';
const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: null };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };

const directoryRow = (id: string, name: string) => ({
  id,
  active: true,
  createdAt: NOW,
  user: {
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    employee: { displayName: name, colorHex: '#4a7c59', role: 'Jardinero' },
    personalProfile: null,
  },
});

type Row = Record<string, unknown> & { id: string };
const activityRow = (id: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  description: `Registro sintético ${id.slice(-2)}`,
  frequency: 'ONE_TIME',
  active: true,
  participantId: Q,
  scheduledDate: null,
  executionOrder: null,
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
  kind: null,
  notes: null,
  version: 1,
  ...extra,
});

/** Filas «guardadas» por id: lo que devuelve `findUnique` (también tras crear). */
let rows: Map<string, Row>;
let calls: string[];

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  rows = new Map();
  calls = [];
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.auditLog.create.mockResolvedValue({});
  db.kitchenGardenParticipant.findMany.mockResolvedValue([
    directoryRow(P, 'Pablo sintético'),
    directoryRow(Q, 'Persona sintética Q'),
  ]);
  db.kitchenGardenExecution.findMany.mockResolvedValue([]);
  db.$queryRaw.mockImplementation((query: { sql: string }) => {
    calls.push('lock');
    return Promise.resolve(
      query.sql.includes('kitchen_garden_activities') ? [{ id: ACTIVITY }] : [{ active: true }],
    );
  });
  db.kitchenGardenActivity.findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
    calls.push('read');
    return Promise.resolve(rows.get(where.id) ?? null);
  });
  let next = 0;
  db.kitchenGardenActivity.create.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => {
      next += 1;
      const id = `00000000-0000-4000-8000-0000000000c${next}`;
      rows.set(id, activityRow(id, { ...data, scheduledDate: data.scheduledDate ?? null }));
      return Promise.resolve({ id });
    },
  );
  db.kitchenGardenActivity.update.mockResolvedValue({});
  db.kitchenGardenPlanningInterval.create.mockResolvedValue({});
  db.kitchenGardenPlanningInterval.updateMany.mockResolvedValue({ count: 1 });
});

const auditStates = () =>
  db.auditLog.create.mock.calls.map(
    ([arg]) =>
      (arg as { data: { action: string; previousState?: unknown; newState?: unknown } }).data,
  );

describe('agenda de 📝 Registros (regla pura)', () => {
  const at = (frequency: string, scheduledDate: string | null, suggestedDate: string | null) =>
    agendaOf({ frequency: frequency as never, scheduledDate, suggestedDate }, TODAY);

  it('«Una vez»: vencida, para hoy, próxima o sin fecha según su fecha prevista', () => {
    expect(at('ONE_TIME', '2026-11-01', null)).toEqual({
      agenda: 'OVERDUE',
      agendaDate: '2026-11-01',
    });
    expect(at('ONE_TIME', TODAY, null)).toEqual({ agenda: 'TODAY', agendaDate: TODAY });
    expect(at('ONE_TIME', '2026-11-05', null)).toEqual({
      agenda: 'UPCOMING',
      agendaDate: '2026-11-05',
    });
    expect(at('ONE_TIME', null, null)).toEqual({ agenda: 'NO_DATE', agendaDate: null });
  });

  it('diaria y urgente, para hoy; una recurrente con la sugerencia pasada NUNCA queda vencida', () => {
    expect(at('DAILY', null, null).agenda).toBe('TODAY');
    expect(at('URGENT', null, null).agenda).toBe('TODAY');
    expect(at('WEEKLY', null, '2026-11-01')).toEqual({
      agenda: 'TODAY',
      agendaDate: '2026-11-01',
    });
    expect(at('MONTHLY', null, '2026-11-20').agenda).toBe('UPCOMING');
    expect(at('SEMI_MONTHLY', null, null).agenda).toBe('NO_DATE');
    for (const frequency of ['WEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'BIMONTHLY', 'ANNUAL']) {
      expect(at(frequency, null, '2026-01-01').agenda).not.toBe('OVERDUE');
    }
  });

  it('orden: grupo → fecha ascendente → orden operativo (desempate estable por id)', () => {
    const item = (id: string, agenda: string, agendaDate: string | null, extra = {}) => ({
      id,
      description: 'Igual',
      frequency: 'ONE_TIME' as const,
      scheduledDate: agendaDate,
      suggestedDate: null,
      executionOrder: null,
      agenda: agenda as (typeof GARDEN_AGENDA_GROUPS)[number],
      agendaDate,
      ...extra,
    });
    const sorted = [
      item('6', 'NO_DATE', null),
      item('5', 'UPCOMING', '2026-11-09'),
      item('4', 'UPCOMING', '2026-11-03'),
      item('3', 'TODAY', TODAY),
      item('2', 'OVERDUE', '2026-10-30'),
      item('1', 'OVERDUE', '2026-10-30'),
    ].sort(compareAgenda);
    expect(sorted.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });
});

describe('listado', () => {
  it('agrupa y ordena en el backend; las anteriores quedan «Sin clasificar» (tipo null)', async () => {
    db.kitchenGardenActivity.findMany.mockResolvedValue([
      activityRow('00000000-0000-4000-8000-0000000000d1', { description: 'Sin fecha' }),
      activityRow('00000000-0000-4000-8000-0000000000d2', {
        description: 'Próxima',
        kind: 'SOWING',
        scheduledDate: new Date('2026-11-04T00:00:00.000Z'),
      }),
      activityRow('00000000-0000-4000-8000-0000000000d3', {
        description: 'Vencida',
        kind: 'TRANSPLANT',
        scheduledDate: new Date('2026-10-28T00:00:00.000Z'),
      }),
      activityRow('00000000-0000-4000-8000-0000000000d4', {
        description: 'Regar',
        frequency: 'WEEKLY',
        suggestedWeekday: 1,
      }),
    ]);
    const result = await listGardenActivities(PABLO, { status: 'active' }, NOW);
    expect(result.activities.map((row) => [row.description, row.agenda, row.kind])).toEqual([
      ['Vencida', 'OVERDUE', 'TRANSPLANT'],
      ['Regar', 'TODAY', null],
      ['Próxima', 'UPCOMING', 'SOWING'],
      ['Sin fecha', 'NO_DATE', null],
    ]);
    expect(result.period).toMatchObject({ today: TODAY, soonUntil: '2026-11-09' });
    expect(result.viewer).toEqual({ canWrite: true, canManage: false });
    expect(result.activities[0]).toMatchObject({ version: 1, notes: null });
  });
});

describe('crear (ADMIN y participantes activos)', () => {
  it('un participante crea un registro para OTRO responsable, con tipo y observaciones', async () => {
    const result = await createGardenActivity(
      PABLO,
      {
        kind: 'OTHER',
        description: 'Desmalezar canteros',
        participantId: Q,
        frequency: 'ONE_TIME',
        scheduledDate: '2026-11-04',
        notes: 'Empezar por el cantero norte',
      },
      META,
      NOW,
    );
    expect(db.kitchenGardenActivity.create).toHaveBeenCalledTimes(1);
    expect(db.kitchenGardenActivity.create.mock.calls[0]![0].data).toMatchObject({
      kind: 'OTHER',
      participantId: Q,
      notes: 'Empezar por el cantero norte',
    });
    expect(db.kitchenGardenPlanningInterval.create).toHaveBeenCalledTimes(1);
    expect(auditStates()[0]).toMatchObject({
      action: 'kitchen_garden.activity_created',
      newState: { kind: 'OTHER', participantId: Q, actorRole: 'EMPLOYEE' },
    });
    expect(result.activity).toMatchObject({ kind: 'OTHER', agenda: 'UPCOMING' });
    expect(result.transplant).toBeNull();
  });

  it('siembra «Una vez» + trasplante: dos actividades independientes en una transacción', async () => {
    const result = await createGardenActivity(
      PABLO,
      {
        kind: 'SOWING',
        description: 'Sembrar LECHUGA sintética',
        participantId: P,
        frequency: 'ONE_TIME',
        scheduledDate: '2026-11-03',
        transplant: {
          description: 'Trasplantar LECHUGA sintética',
          participantId: Q,
          scheduledDate: '2026-11-20',
        },
      },
      META,
      NOW,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const created = db.kitchenGardenActivity.create.mock.calls.map(([arg]) => arg.data);
    expect(created).toHaveLength(2);
    expect(created[1]).toMatchObject({
      kind: 'TRANSPLANT',
      frequency: 'ONE_TIME',
      participantId: Q,
      notes: null,
    });
    expect(db.kitchenGardenPlanningInterval.create).toHaveBeenCalledTimes(2);
    const [sowingAudit, transplantAudit] = auditStates();
    expect(sowingAudit!.newState).not.toHaveProperty('scheduledWithSowingId');
    expect(transplantAudit!.newState).toMatchObject({ scheduledWithSowingId: result.activity.id });
    expect(result.transplant).toMatchObject({
      kind: 'TRANSPLANT',
      scheduledDate: '2026-11-20',
      currentExecution: null,
    });
  });

  it.each([
    ['tipo distinto de siembra', { kind: 'OTHER' }],
    ['siembra recurrente', { frequency: 'WEEKLY', scheduledDate: undefined }],
    ['trasplante antes de la siembra', { scheduledDate: '2026-11-25' }],
  ])('trasplante con %s → 400 sin abrir transacción', async (_label, override) => {
    await expect(
      createGardenActivity(
        ADMIN,
        {
          kind: 'SOWING',
          description: 'Sembrar sintético',
          participantId: P,
          frequency: 'ONE_TIME',
          scheduledDate: '2026-11-03',
          transplant: {
            description: 'Trasplantar sintético',
            participantId: P,
            scheduledDate: '2026-11-20',
          },
          ...(override as object),
        },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('si el trasplante falla, la transacción entera falla (no queda la siembra sola)', async () => {
    // Responsable del trasplante inactivo: la segunda verificación (dentro de la misma transacción) falla.
    db.$queryRaw.mockImplementation((query: { values: unknown[] }) =>
      Promise.resolve(query.values.includes(Q) ? [{ active: false }] : [{ active: true }]),
    );
    await expect(
      createGardenActivity(
        ADMIN,
        {
          kind: 'SOWING',
          description: 'Sembrar sintético',
          participantId: P,
          frequency: 'ONE_TIME',
          transplant: { description: 'Trasplantar sintético', participantId: Q },
        },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    // La siembra ya se había insertado DENTRO de la misma transacción, que se
    // interrumpe: la base la revierte entera (verificado contra `demo`).
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.kitchenGardenActivity.create).toHaveBeenCalledTimes(1);
  });
});

describe('editar (versión, bloqueo y sin cambios)', () => {
  beforeEach(() => {
    rows.set(ACTIVITY, activityRow(ACTIVITY, { version: 3 }));
  });

  it('bloquea la fila ANTES de leerla; versión distinta → 409 sin escribir', async () => {
    await expect(
      updateGardenActivity(PABLO, ACTIVITY, { version: 2, kind: 'SOWING' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 409, code: 'GARDEN_ACTIVITY_CHANGED' });
    expect(calls.slice(0, 2)).toEqual(['lock', 'read']);
    expect(db.kitchenGardenActivity.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('sin cambios reales no escribe ni audita (ni sube la versión)', async () => {
    await updateGardenActivity(
      PABLO,
      ACTIVITY,
      { version: 3, description: 'Registro sintético b1', notes: null },
      META,
      NOW,
    );
    expect(db.kitchenGardenActivity.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('clasificar y anotar (también lo de otro responsable) no toca la planificación', async () => {
    await updateGardenActivity(
      PABLO,
      ACTIVITY,
      { version: 3, kind: 'TRANSPLANT', notes: 'Con cuidado' },
      META,
      NOW,
    );
    expect(db.kitchenGardenPlanningInterval.updateMany).not.toHaveBeenCalled();
    expect(db.kitchenGardenPlanningInterval.create).not.toHaveBeenCalled();
    expect(db.kitchenGardenActivity.update.mock.calls[0]![0].data).toEqual({
      kind: 'TRANSPLANT',
      notes: 'Con cuidado',
      version: { increment: 1 },
    });
    expect(auditStates()[0]).toMatchObject({
      action: 'kitchen_garden.activity_updated',
      previousState: { kind: null, notes: null, version: 3 },
      newState: { kind: 'TRANSPLANT', notes: 'Con cuidado', version: 4, actorRole: 'EMPLOYEE' },
    });
  });

  it('reprogramar la fecha sí cierra y abre una versión de planificación', async () => {
    await updateGardenActivity(
      PABLO,
      ACTIVITY,
      { version: 3, scheduledDate: '2026-11-10' },
      META,
      NOW,
    );
    expect(db.kitchenGardenPlanningInterval.updateMany).toHaveBeenCalledTimes(1);
    expect(db.kitchenGardenPlanningInterval.create).toHaveBeenCalledTimes(1);
  });

  it('un participante no edita registros desactivados (sigue siendo del ADMIN)', async () => {
    rows.set(ACTIVITY, activityRow(ACTIVITY, { version: 3, active: false }));
    await expect(
      updateGardenActivity(PABLO, ACTIVITY, { version: 3, kind: 'OTHER' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.kitchenGardenActivity.update).not.toHaveBeenCalled();
  });

  it('desactivar (solo ADMIN) también sube la versión: una edición abierta antes no lo pisa', async () => {
    await setGardenActivityActive(ADMIN, ACTIVITY, false, META, NOW);
    expect(db.kitchenGardenActivity.update.mock.calls[0]![0].data).toEqual({
      active: false,
      version: { increment: 1 },
    });
  });
});

describe('validación de entrada', () => {
  const base = {
    kind: 'SOWING',
    description: 'Sembrar sintético',
    participantId: P,
    frequency: 'ONE_TIME',
  };

  it('el tipo es obligatorio al crear; observaciones vacías = sin observaciones', () => {
    expect(createGardenActivityBodySchema.safeParse({ ...base, kind: undefined }).success).toBe(
      false,
    );
    expect(createGardenActivityBodySchema.parse({ ...base, notes: '   ' }).notes).toBeNull();
    expect(createGardenActivityBodySchema.parse({ ...base, notes: ' a  b ' }).notes).toBe('a b');
    expect(
      createGardenActivityBodySchema.safeParse({ ...base, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(createGardenActivityBodySchema.safeParse({ ...base, kind: 'HARVEST' }).success).toBe(
      false,
    );
  });

  it('editar exige la versión, no admite quitar el tipo y rechaza un cuerpo sin cambios', () => {
    expect(updateGardenActivityBodySchema.safeParse({ kind: 'OTHER' }).success).toBe(false);
    expect(updateGardenActivityBodySchema.safeParse({ version: 1 }).success).toBe(false);
    expect(updateGardenActivityBodySchema.safeParse({ version: 1, kind: null }).success).toBe(
      false,
    );
    expect(updateGardenActivityBodySchema.parse({ version: 1, notes: '' })).toEqual({
      version: 1,
      notes: null,
    });
  });
});
