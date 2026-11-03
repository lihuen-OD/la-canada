import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🥬 Huerta → 📝 Registros: «Una vez» y urgentes completadas siguen visibles
 * (tachadas) durante la semana de negocio de su finalización vigente
 * (`completedAt`) y salen el lunes siguiente, como en ✅ Tareas. Recurrentes,
 * `status=all` y pendientes vencidas sin cambios. Prisma simulado.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    kitchenGardenParticipant: { findMany: fn() },
    kitchenGardenActivity: { findMany: fn() },
    kitchenGardenExecution: { findMany: fn() },
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { listGardenActivities } from '../../kitchenGarden/gardenActivitiesService';
import type { GardenActor } from '../../kitchenGarden/gardenParticipants';

const P = '00000000-0000-4000-8000-0000000000a1';
const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: null };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };
const ar = (day: string, time: string) => new Date(`${day}T${time}-03:00`);

const row = (id: string, frequency: string, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-0000000000${id}`,
  description: `Registro sintético ${id}`,
  frequency,
  active: true,
  participantId: P,
  scheduledDate: null,
  executionOrder: null,
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
  kind: 'SOWING',
  notes: null,
  version: 1,
  ...extra,
});
const execution = (activityId: string, periodKey: string, completedAt: Date) => ({
  id: `e-${activityId}`,
  activityId,
  periodKey,
  completedAt,
  assignedParticipantId: P,
  completedByParticipantId: P,
});

const ONE = row('c1', 'ONE_TIME', { scheduledDate: new Date('2026-10-20T00:00:00.000Z') });
const URGENT = row('c2', 'URGENT');
const DAILY = row('c3', 'DAILY');
const PENDING_OVERDUE = row('c4', 'ONE_TIME', {
  scheduledDate: new Date('2026-09-01T00:00:00.000Z'),
});

/** Ejecuciones vigentes: la «Una vez» y la urgente completadas el miércoles 28/10 a las 10 h. */
function mockData(completedAt: Date, dailyAt: Date | null) {
  db.kitchenGardenActivity.findMany.mockResolvedValue([ONE, URGENT, DAILY, PENDING_OVERDUE]);
  db.kitchenGardenExecution.findMany.mockImplementation(
    ({ where }: { where: { OR: { activityId: string; periodKey: string }[] } }) =>
      Promise.resolve(
        [
          execution(ONE.id, 'ONE_TIME', completedAt),
          execution(URGENT.id, 'URGENT', completedAt),
          ...(dailyAt ? [execution(DAILY.id, '2026-11-01', dailyAt)] : []),
        ].filter((candidate) =>
          where.OR.some(
            (key) =>
              key.activityId === candidate.activityId && key.periodKey === candidate.periodKey,
          ),
        ),
      ),
  );
}

const visible = async (
  now: Date,
  actor: GardenActor = PABLO,
  status: 'active' | 'all' = 'active',
) =>
  (await listGardenActivities(actor, { status }, now)).activities.map((item) => [
    item.description,
    item.currentExecution ? 'completada' : 'pendiente',
  ]);

beforeEach(() => {
  for (const group of Object.values(db))
    for (const method of Object.values(group)) method.mockReset();
  db.kitchenGardenParticipant.findMany.mockResolvedValue([]);
});

describe('completadas durante su semana (zona de negocio)', () => {
  it('visibles y tachadas hasta el domingo 23:59 de Argentina, aunque en UTC ya sea lunes', async () => {
    mockData(ar('2026-10-28', '10:00:00'), null);
    // Domingo 01/11 a las 22:30 de Argentina = lunes 02/11 01:30 UTC.
    expect(await visible(ar('2026-11-01', '22:30:00'))).toEqual(
      expect.arrayContaining([
        ['Registro sintético c1', 'completada'],
        ['Registro sintético c2', 'completada'],
      ]),
    );
    expect(await visible(ar('2026-11-01', '23:59:59'))).toHaveLength(4);
  });

  it('el lunes siguiente a las 00:00 salen del listado; la pendiente vencida sigue', async () => {
    mockData(ar('2026-10-28', '10:00:00'), null);
    const rows = await visible(ar('2026-11-02', '00:00:00'));
    expect(rows.map(([description]) => description)).toEqual([
      'Registro sintético c4',
      'Registro sintético c3',
    ]);
    expect(rows).toContainEqual(['Registro sintético c4', 'pendiente']);
  });

  it('se usa la finalización, no la fecha prevista: una «Una vez» atrasada completada esta semana se ve', async () => {
    // Fecha prevista 20/10 (semana anterior), completada el lunes 02/11.
    mockData(ar('2026-11-02', '09:00:00'), null);
    expect(await visible(ar('2026-11-08', '20:00:00'))).toContainEqual([
      'Registro sintético c1',
      'completada',
    ]);
    expect(await visible(ar('2026-11-09', '00:00:00'))).not.toContainEqual([
      'Registro sintético c1',
      'completada',
    ]);
  });

  it('las recurrentes conservan su período: la diaria completada el domingo vuelve pendiente el lunes', async () => {
    mockData(ar('2026-10-28', '10:00:00'), ar('2026-11-01', '18:00:00'));
    expect(await visible(ar('2026-11-01', '23:00:00'))).toContainEqual([
      'Registro sintético c3',
      'completada',
    ]);
    expect(await visible(ar('2026-11-02', '00:00:01'))).toContainEqual([
      'Registro sintético c3',
      'pendiente',
    ]);
  });

  it('con `status=all` (ADMIN) se siguen viendo las de semanas anteriores', async () => {
    mockData(ar('2026-10-01', '10:00:00'), null);
    expect(await visible(ar('2026-11-02', '12:00:00'), ADMIN, 'all')).toEqual(
      expect.arrayContaining([
        ['Registro sintético c1', 'completada'],
        ['Registro sintético c2', 'completada'],
      ]),
    );
  });
});
