import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🥬 Huerta → Desempeño con Prisma simulado: el ejemplo numérico documentado
 * en docs/BUSINESS_RULES.md ("🥬 Huerta", Desempeño). Usa el MISMO
 * calculador que Tareas → Desempeño; acá se prueba que la planificación y las
 * ejecuciones de la Huerta llegan bien, los totales por participante, la
 * visibilidad por rol y el caso sin obligaciones. La SQL real se prueba
 * contra `demo` en `kitchenGarden.integration.test.ts`.
 */
const db = vi.hoisted(() => ({
  kitchenGardenParticipant: { findMany: vi.fn(), findUnique: vi.fn() },
  kitchenGardenPlanningInterval: { findMany: vi.fn() },
  kitchenGardenExecution: { findMany: vi.fn() },
  kitchenGardenActivity: { count: vi.fn() },
}));
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { getGardenPerformance } from '../../kitchenGarden/gardenPerformanceService';

const P = '00000000-0000-4000-8000-0000000000a1'; // Pablo sintético (empleado)
const V = '00000000-0000-4000-8000-0000000000a2'; // Admin sintético (ADMIN sin ficha)
const C = '00000000-0000-4000-8000-0000000000a3'; // participante sin actividades
/** Instante `HH:MM` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00') => new Date(`${day}T${time}:00.000-03:00`);
const D = (day: string) => new Date(`${day}T00:00:00.000Z`);
const NOW = ar('2026-10-26', '18:00'); // lunes
const RANGE = { from: '2026-10-20', to: '2026-10-26' }; // 7 días

const participant = (id: string, name: string, admin = false) => ({
  id,
  active: true,
  createdAt: ar('2026-10-01'),
  user: {
    role: admin ? 'ADMIN' : 'EMPLOYEE',
    status: 'ACTIVE',
    employee: admin ? null : { displayName: name, colorHex: '#4a7c59', role: 'Jardinero' },
    personalProfile: admin ? { displayName: name } : null,
  },
});

const plan = (
  activityId: string,
  description: string,
  participantId: string,
  frequency: string,
  validFrom: Date,
  extra: { validTo?: Date; scheduledDate?: Date } = {},
) => ({
  id: `${activityId}-${participantId}-${validFrom.getTime()}`,
  activityId,
  participantId,
  frequency,
  scheduledDate: extra.scheduledDate ?? null,
  validFrom,
  validTo: extra.validTo ?? null,
  activity: { description },
});

const execution = (
  activityId: string,
  periodKey: string,
  assigned: string,
  by: string,
  at: Date,
) => ({
  id: `${activityId}-${periodKey}`,
  activityId,
  periodKey,
  assignedParticipantId: assigned,
  completedByParticipantId: by,
  completedAt: at,
});

/** El ejemplo documentado (7 días, del 20 al 26/10/2026, visto el 26 a las 18 h). */
function arrangeExample() {
  db.kitchenGardenParticipant.findMany.mockResolvedValue([
    participant(P, 'Pablo sintético'),
    participant(V, 'Admin sintético', true),
    participant(C, 'Persona sintética C'),
  ]);
  db.kitchenGardenPlanningInterval.findMany.mockResolvedValue([
    plan('a1', 'Regar almácigos', P, 'DAILY', ar('2026-10-01', '08:00')),
    plan('a2', 'Desmalezar canteros', V, 'WEEKLY', ar('2026-10-01', '08:00')),
    plan('a3', 'Sembrar lechuga', P, 'ONE_TIME', ar('2026-10-21', '09:00'), {
      scheduledDate: D('2026-10-30'),
    }),
    plan('a4', 'Revisar riego por goteo', P, 'ONE_TIME', ar('2026-10-21', '09:00'), {
      scheduledDate: D('2026-10-24'),
    }),
    // Reasignada a mitad del 24: del 20 al 23 es de Pablo; del 24 en adelante, de Admin.
    plan('a5', 'Ventilar invernadero', P, 'DAILY', ar('2026-10-01', '08:00'), {
      validTo: ar('2026-10-24', '12:00'),
    }),
    plan('a5', 'Ventilar invernadero', V, 'DAILY', ar('2026-10-24', '12:00')),
  ]);
  db.kitchenGardenExecution.findMany.mockResolvedValue([
    ...['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-24'].map((day) =>
      execution('a1', day, P, P, ar(day, '09:00')),
    ),
    execution('a1', '2026-10-23', P, V, ar('2026-10-23', '10:00')), // cobertura: la hizo Admin
    execution('a2', '2026-10-26', V, V, ar('2026-10-26', '09:00')),
    execution('a5', '2026-10-20', P, P, ar('2026-10-20', '09:00')),
    execution('a5', '2026-10-21', P, P, ar('2026-10-21', '09:00')),
    execution('a5', '2026-10-24', V, V, ar('2026-10-24', '15:00')),
    execution('a5', '2026-10-25', V, V, ar('2026-10-25', '09:00')),
  ]);
  db.kitchenGardenActivity.count.mockResolvedValue(0);
}

const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: V };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
});

describe('🥬 Desempeño de la Huerta — ejemplo documentado', () => {
  it('ADMIN: métricas por participante y del equipo, sin contar dos veces la reasignación', async () => {
    arrangeExample();
    const result = await getGardenPerformance(ADMIN, RANGE, undefined, NOW);
    const byId = Object.fromEntries(result.participants.map((row) => [row.participant.id, row]));

    // Pablo: Regar 7 (4 propias, 1 cubierta, 2 sin completar) + Ventilar 20–23
    // (2 propias, 2 sin completar) + «Una vez» vencida el 24 (sin completar).
    // La del 30/10 todavía no es exigible.
    expect(byId[P]).toMatchObject({
      assigned: 12,
      completedPersonally: 6,
      percentage: 50,
      pending: 5,
      coverageReceived: 1,
      coverageGiven: 0,
    });
    // Admin: Desmalezar (semana del 26) propia + Ventilar 24–26 (2 propias, 1 sin
    // completar) y cubrió a Pablo el 23 (no suma a su porcentaje).
    expect(byId[V]).toMatchObject({
      assigned: 4,
      completedPersonally: 3,
      percentage: 75,
      pending: 1,
      coverageReceived: 0,
      coverageGiven: 1,
    });
    // Sin obligaciones: nunca un 0 % engañoso.
    expect(byId[C]).toMatchObject({ assigned: 0, completedPersonally: 0, percentage: null });
    expect(result.team).toMatchObject({
      assigned: 16,
      completedPersonally: 9,
      percentage: 56.3,
      pending: 6,
      coverageReceived: 1,
      coverageGiven: 1,
    });
    expect(result.scope).toBe('team');
    expect(result.occurrences).toBeUndefined();
    expect(byId[V]!.participant).toMatchObject({
      displayName: 'Admin sintético',
      roleLabel: 'Administrador',
    });
  });

  it('detalle de un participante (ADMIN): quién estaba asignado y quién la realizó', async () => {
    arrangeExample();
    const result = await getGardenPerformance(ADMIN, RANGE, P, NOW);
    const covered = result.occurrences!.find(
      (item) => item.activityId === 'a1' && item.periodKey === '2026-10-23',
    );
    expect(covered).toMatchObject({
      status: 'covered',
      assignedTo: { id: P, displayName: 'Pablo sintético' },
      completedBy: { id: V, displayName: 'Admin sintético' },
    });
    expect(result.occurrences!.find((item) => item.activityId === 'a4')).toMatchObject({
      status: 'pending',
      scheduledDate: '2026-10-24',
      completedBy: null,
    });
    expect(result.occurrences!.some((item) => item.activityId === 'a3')).toBe(false);
  });

  it('un participante (no ADMIN) ve solo lo suyo y nunca el nombre de otra persona', async () => {
    arrangeExample();
    const result = await getGardenPerformance(PABLO, RANGE, undefined, NOW);
    expect(result.scope).toBe('self');
    expect(result.participants.map((row) => row.participant.id)).toEqual([P]);
    expect(result.team).toMatchObject({ assigned: 12, completedPersonally: 6, percentage: 50 });
    const covered = result.occurrences!.find(
      (item) => item.activityId === 'a1' && item.periodKey === '2026-10-23',
    );
    expect(covered).toMatchObject({ assignedTo: { id: P }, completedBy: null });
    await expect(getGardenPerformance(PABLO, RANGE, V, NOW)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('sin participación ni obligaciones: sin filas ni porcentaje', async () => {
    arrangeExample();
    db.kitchenGardenParticipant.findUnique.mockResolvedValue(null);
    const outsider = { userId: 'u-x', role: 'EMPLOYEE' as const, participantId: null };
    const result = await getGardenPerformance(outsider, RANGE, undefined, NOW);
    expect(result.scope).toBe('none');
    expect(result.participants).toEqual([]);
    expect(result.team).toMatchObject({ assigned: 0, percentage: null });

    db.kitchenGardenPlanningInterval.findMany.mockResolvedValue([]);
    db.kitchenGardenExecution.findMany.mockResolvedValue([]);
    const empty = await getGardenPerformance(ADMIN, RANGE, undefined, NOW);
    expect(empty.team).toMatchObject({ assigned: 0, completedPersonally: 0, percentage: null });
    expect(empty.participants.every((row) => row.percentage === null)).toBe(true);
  });

  it('rangos: los mismos de Tareas (7, 14 o 30 días)', async () => {
    arrangeExample();
    await expect(
      getGardenPerformance(ADMIN, { from: '2026-10-21', to: '2026-10-26' }, undefined, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
