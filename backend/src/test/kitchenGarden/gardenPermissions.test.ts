import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🥬 Huerta — permisos y reglas de participantes con Prisma simulado: lo
 * administrativo es solo de ADMIN; completar es del participante activo
 * responsable (o de un ADMIN indicando quién la realizó); la participación no
 * concede permisos de ADMIN; desactivar a quien tiene actividades activas se
 * rechaza sin reasignar ni borrar nada. La SQL real se prueba contra `demo`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    kitchenGardenParticipant: {
      findMany: fn(),
      findUnique: fn(),
      findUniqueOrThrow: fn(),
      update: fn(),
      updateMany: fn(),
      create: fn(),
    },
    kitchenGardenActivity: { findMany: fn(), findUnique: fn(), count: fn() },
    kitchenGardenExecution: { findMany: fn(), findUnique: fn(), create: fn(), updateMany: fn() },
    user: { findUnique: fn(), findMany: fn() },
    auditLog: { create: fn() },
    $queryRaw: fn(),
    $transaction: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  addGardenParticipant,
  listGardenCandidates,
  setGardenParticipantActive,
} from '../../kitchenGarden/gardenParticipants';
import {
  completeGardenActivity,
  createGardenActivity,
  listGardenActivities,
  revertGardenCompletion,
  setGardenActivityActive,
  updateGardenActivity,
} from '../../kitchenGarden/gardenActivitiesService';

const META = { ipAddress: null, userAgent: 'vitest' };
const NOW = new Date('2026-10-26T15:00:00.000Z');
const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const ACTIVITY = '00000000-0000-4000-8000-0000000000b1';
const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: null };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };
const OUTSIDER = { userId: 'u-x', role: 'EMPLOYEE' as const, participantId: null };

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
const activityRow = (id: string, participantId: string, extra = {}) => ({
  id,
  description: `Actividad sintética ${id.slice(-2)}`,
  frequency: 'DAILY',
  active: true,
  participantId,
  scheduledDate: null,
  executionOrder: null,
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
  ...extra,
});

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.auditLog.create.mockResolvedValue({});
  db.kitchenGardenParticipant.findMany.mockResolvedValue([
    directoryRow(P, 'Pablo sintético'),
    directoryRow(Q, 'Persona sintética Q'),
  ]);
  db.kitchenGardenExecution.findMany.mockResolvedValue([]);
});

describe('administración: solo ADMIN (la participación no da permisos de ADMIN)', () => {
  it.each([
    [
      'crear',
      () =>
        createGardenActivity(
          PABLO,
          { description: 'x y z', participantId: P, frequency: 'DAILY' },
          META,
        ),
    ],
    ['editar', () => updateGardenActivity(PABLO, ACTIVITY, { description: 'Otra' }, META)],
    ['desactivar', () => setGardenActivityActive(PABLO, ACTIVITY, false, META)],
    ['ver candidatos', () => listGardenCandidates(PABLO)],
    ['agregar participante', () => addGardenParticipant(PABLO, 'u-otro', META)],
    ['desactivar participante', () => setGardenParticipantActive(PABLO, Q, false, META)],
    ['ver desactivadas', () => listGardenActivities(PABLO, { status: 'all' }, NOW)],
  ])('%s → 403 sin tocar la base', async (_label, run) => {
    await expect(run()).rejects.toMatchObject({ statusCode: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('completar', () => {
  it('quien no participa no puede completar', async () => {
    await expect(
      completeGardenActivity(OUTSIDER, ACTIVITY, undefined, META, NOW),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('un participante no registra a nombre de otra persona', async () => {
    await expect(completeGardenActivity(PABLO, ACTIVITY, Q, META, NOW)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('un participante completa solo actividades asignadas a él', async () => {
    db.kitchenGardenActivity.findUnique.mockResolvedValue({
      id: ACTIVITY,
      active: true,
      participantId: Q,
      frequency: 'DAILY',
    });
    await expect(
      completeGardenActivity(PABLO, ACTIVITY, undefined, META, NOW),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(db.kitchenGardenExecution.create).not.toHaveBeenCalled();
  });

  it('ADMIN sin participación debe indicar quién la realizó, y debe ser un participante activo', async () => {
    await expect(
      completeGardenActivity(ADMIN, ACTIVITY, undefined, META, NOW),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    db.kitchenGardenActivity.findUnique.mockResolvedValue({
      id: ACTIVITY,
      active: true,
      participantId: P,
      frequency: 'DAILY',
    });
    db.kitchenGardenParticipant.findUnique.mockResolvedValue({ active: false });
    await expect(completeGardenActivity(ADMIN, ACTIVITY, Q, META, NOW)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(db.kitchenGardenExecution.create).not.toHaveBeenCalled();
  });

  it('ADMIN registra a nombre de otro participante: responsable, ejecutor y usuario de la sesión por separado', async () => {
    db.kitchenGardenActivity.findUnique
      .mockResolvedValueOnce({ id: ACTIVITY, active: true, participantId: P, frequency: 'DAILY' })
      .mockResolvedValueOnce(activityRow(ACTIVITY, P));
    db.kitchenGardenParticipant.findUnique.mockResolvedValue({ active: true });
    db.kitchenGardenExecution.create.mockResolvedValue({ id: 'x1' });
    await completeGardenActivity(ADMIN, ACTIVITY, Q, META, NOW);
    expect(db.kitchenGardenExecution.create.mock.calls[0]?.[0].data).toMatchObject({
      activityId: ACTIVITY,
      periodKey: '2026-10-26',
      assignedParticipantId: P,
      completedByParticipantId: Q,
      recordedByUserId: 'u-admin',
    });
    expect(db.auditLog.create.mock.calls[0]?.[0].data).toMatchObject({
      action: 'kitchen_garden.activity_completed',
      entityType: 'KitchenGardenExecution',
      newState: { registeredOnBehalf: true, actorRole: 'ADMIN' },
    });
  });

  it('canComplete: ADMIN cualquiera; participante solo las suyas; quien no participa, ninguna', async () => {
    db.kitchenGardenActivity.findMany.mockResolvedValue([
      activityRow('00000000-0000-4000-8000-0000000000b1', P),
      activityRow('00000000-0000-4000-8000-0000000000b2', Q),
    ]);
    const flags = async (actor: typeof ADMIN | typeof PABLO | typeof OUTSIDER) =>
      (await listGardenActivities(actor, { status: 'active' }, NOW)).activities.map((activity) => [
        activity.responsible.id,
        activity.canComplete,
      ]);
    expect(await flags(ADMIN)).toEqual([
      [P, true],
      [Q, true],
    ]);
    expect(await flags(PABLO)).toEqual([
      [P, true],
      [Q, false],
    ]);
    expect(await flags(OUTSIDER)).toEqual([
      [P, false],
      [Q, false],
    ]);
  });
});

describe('revertir', () => {
  it('ADMIN corrige con motivo obligatorio', async () => {
    await expect(
      revertGardenCompletion(ADMIN, ACTIVITY, { executionId: ACTIVITY }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('un participante no deshace lo que hizo otra persona', async () => {
    db.kitchenGardenExecution.findUnique.mockResolvedValue({
      id: 'x1',
      activityId: ACTIVITY,
      periodKey: '2026-10-26',
      revertedAt: null,
      completedByParticipantId: Q,
      activity: { frequency: 'DAILY' },
    });
    await expect(
      revertGardenCompletion(PABLO, ACTIVITY, { executionId: 'x1' }, META, NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.kitchenGardenExecution.updateMany).not.toHaveBeenCalled();
  });
});

describe('participantes', () => {
  it('desactivar con actividades activas: 409 claro, sin reasignar ni borrar', async () => {
    db.$queryRaw.mockResolvedValue([{ active: true }]);
    db.kitchenGardenActivity.count.mockResolvedValue(2);
    await expect(setGardenParticipantActive(ADMIN, P, false, META)).rejects.toMatchObject({
      statusCode: 409,
      code: 'GARDEN_PARTICIPANT_HAS_ACTIVITIES',
      message: expect.stringContaining('2 actividades activas asignadas'),
    });
    expect(db.kitchenGardenParticipant.update).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('agregar exige un usuario ACTIVE existente (nunca crea usuarios ni empleados)', async () => {
    db.user.findUnique.mockResolvedValue({ status: 'SUSPENDED', kitchenGardenParticipant: null });
    await expect(addGardenParticipant(ADMIN, 'u-suspendido', META)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(db.kitchenGardenParticipant.create).not.toHaveBeenCalled();
  });

  it('volver a agregar a quien fue desactivado reactiva la misma participación', async () => {
    db.user.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      kitchenGardenParticipant: { id: P, active: false },
    });
    db.kitchenGardenParticipant.updateMany.mockResolvedValue({ count: 1 });
    db.kitchenGardenParticipant.findUniqueOrThrow.mockResolvedValue(
      directoryRow(P, 'Pablo sintético'),
    );
    const { participant } = await addGardenParticipant(ADMIN, 'u-pablo', META);
    expect(participant).toMatchObject({ id: P, active: true, displayName: 'Pablo sintético' });
    expect(db.kitchenGardenParticipant.create).not.toHaveBeenCalled();
    expect(db.auditLog.create.mock.calls[0]?.[0].data.action).toBe(
      'kitchen_garden.participant_reactivated',
    );
  });
});
