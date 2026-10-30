import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client';

const mocks = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  plans: vi.fn(),
  executions: vi.fn(),
  employeeFindUnique: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('../../lib/prisma', () => {
  const tx = {
    employee: { findUnique: mocks.employeeFindUnique },
    taskExecution: { create: mocks.create },
    auditLog: { create: mocks.audit },
  };
  return {
    prisma: {
      task: { findUnique: mocks.taskFindUnique },
      taskPlanningInterval: { findMany: mocks.plans },
      taskExecution: { findMany: mocks.executions },
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import {
  ForbiddenError,
  NotFoundError,
  TaskObligationAlreadyCompletedError,
  TaskObligationUnavailableError,
} from '../../errors/AppError';
import { registerLateCompletion } from '../../tasks/tasksService';

/**
 * «Marcar como realizada» (carga olvidada) con Prisma simulado: la obligación
 * se reconstruye con la planificación histórica y las ejecuciones vigentes
 * (lo mismo que lee Desempeño), nunca con lo que manda el cliente ni con el
 * período vigente. La unicidad real y la concurrencia se prueban contra
 * Postgres en `tasksLateCompletion.integration.test.ts`.
 */
const ar = (date: string, time = '12:00') => new Date(`${date}T${time}:00-03:00`);
// Viernes 30/10/2026, 12:00 en Buenos Aires.
const NOW = ar('2026-10-30');
const COKE = '11111111-1111-4111-8111-111111111111';
const JUAN = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const coke = { userId: 'u-coke', role: 'EMPLOYEE' as const, employeeId: COKE };
const juan = { userId: 'u-juan', role: 'EMPLOYEE' as const, employeeId: JUAN };
const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const META = { ipAddress: null, userAgent: null };

type Frequency = 'DAILY' | 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'BIMONTHLY' | 'ANNUAL';
const plan = (
  frequency: Frequency,
  validFrom: Date,
  validTo: Date | null = null,
  employeeId = COKE,
) => ({
  id: `p-${validFrom.toISOString()}`,
  taskId: TASK,
  employeeId,
  frequency,
  scheduledDate: null,
  validFrom,
  validTo,
  task: { description: 'Aspirar planta baja (sintética)' },
});
const execution = (periodKey: string, completedBy = COKE, assigned = COKE) => ({
  id: `x-${periodKey}`,
  taskId: TASK,
  periodKey,
  assignedEmployeeId: assigned,
  completedByEmployeeId: completedBy,
  completedAt: ar('2026-10-30', '08:00'),
  performedOn: null,
  recordedByUserId: 'u-coke',
});

const register = (
  actor: typeof coke | typeof admin,
  periodKey: string,
  performedOn: string,
  employeeId?: string,
  now = NOW,
) =>
  registerLateCompletion(
    actor,
    TASK,
    { periodKey, performedOn, ...(employeeId ? { employeeId } : {}) },
    META,
    now,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.taskFindUnique.mockResolvedValue({ id: TASK });
  mocks.plans.mockResolvedValue([plan('DAILY', ar('2026-09-01'))]);
  mocks.executions.mockResolvedValue([]);
  mocks.employeeFindUnique.mockResolvedValue({ active: true });
  mocks.create.mockResolvedValue({ id: 'nueva' });
  mocks.audit.mockResolvedValue({});
});

describe('carga olvidada — diaria de ayer cargada hoy', () => {
  it('completa SOLO el 29/10, con fecha real, momento de registro, responsable histórico y autor', async () => {
    const result = await register(coke, '2026-10-29', '2026-10-29');
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]![0].data).toEqual({
      taskId: TASK,
      periodKey: '2026-10-29',
      completed: true,
      completedAt: NOW,
      performedOn: new Date('2026-10-29T00:00:00.000Z'),
      assignedEmployeeId: COKE,
      completedByEmployeeId: COKE,
      recordedByUserId: 'u-coke',
    });
    expect(mocks.audit.mock.calls[0]![0].data).toMatchObject({
      actorUserId: 'u-coke',
      action: 'task.completed_late',
      entityType: 'TaskExecution',
      entityId: 'nueva',
      newState: {
        taskId: TASK,
        periodKey: '2026-10-29',
        frequency: 'DAILY',
        performedOn: '2026-10-29',
        assignedEmployeeId: COKE,
        completedByEmployeeId: COKE,
        actorRole: 'EMPLOYEE',
        registeredOnBehalf: false,
      },
    });
    expect(result.completion).toMatchObject({
      periodKey: '2026-10-29',
      performedOn: '2026-10-29',
      recordedAt: NOW.toISOString(),
      status: 'personal',
    });
  });

  it('lee la misma planificación y ejecuciones que Desempeño, acotadas a la tarea y a la ventana de 30 días', async () => {
    await register(coke, '2026-10-29', '2026-10-29');
    const planWhere = mocks.plans.mock.calls[0]![0].where;
    expect(planWhere.taskId).toBe(TASK);
    expect(planWhere.validFrom.lt).toEqual(ar('2026-10-31', '00:00'));
    expect(planWhere.OR[1].validTo.gte).toEqual(ar('2026-10-01', '00:00'));
    const executionWhere = mocks.executions.mock.calls[0]![0].where;
    expect(executionWhere).toMatchObject({ revertedAt: null, taskId: TASK });
    expect(executionWhere.OR[0].periodKey).toEqual({ gte: '2026-10-01', lte: '2026-10-30' });
  });

  it('se puede aunque la de hoy ya esté completada (y la de hoy no se toca)', async () => {
    mocks.executions.mockResolvedValue([execution('2026-10-30')]);
    await register(coke, '2026-10-29', '2026-10-29');
    expect(mocks.create.mock.calls[0]![0].data.periodKey).toBe('2026-10-29');
  });

  it('la diaria queda fijada por la fila: otro día → 400', async () => {
    await expect(register(coke, '2026-10-29', '2026-10-28')).rejects.toThrow(
      'La fecha tiene que estar dentro del período de la tarea.',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('ya registrada (por ella o por otra persona) → 409, sin reemplazar la ejecución', async () => {
    mocks.executions.mockResolvedValue([execution('2026-10-29', JUAN)]);
    await expect(register(coke, '2026-10-29', '2026-10-29')).rejects.toBeInstanceOf(
      TaskObligationAlreadyCompletedError,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('otra persona la registró entre la lectura y la escritura (índice único) → 409 claro', async () => {
    mocks.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(register(coke, '2026-10-29', '2026-10-29')).rejects.toBeInstanceOf(
      TaskObligationAlreadyCompletedError,
    );
  });
});

describe('carga olvidada — fechas, períodos y existencia', () => {
  it('fecha futura → 400 sin consultar la base', async () => {
    await expect(register(coke, '2026-10-29', '2026-10-31')).rejects.toThrow(
      'La fecha en que se realizó no puede ser futura.',
    );
    expect(mocks.plans).not.toHaveBeenCalled();
  });

  it('a las 23:30 de Buenos Aires (02:30 UTC) todavía es el 30: hoy vale y el 31 es futuro', async () => {
    const lateNight = new Date('2026-10-31T02:30:00Z');
    await expect(
      register(coke, '2026-10-30', '2026-10-30', undefined, lateNight),
    ).resolves.toBeDefined();
    await expect(register(coke, '2026-10-30', '2026-10-31', undefined, lateNight)).rejects.toThrow(
      'no puede ser futura',
    );
  });

  it('semanal cerrada: cualquier día de esa semana; fuera de ella → 400', async () => {
    mocks.plans.mockResolvedValue([plan('WEEKLY', ar('2026-09-01'))]);
    await register(coke, '2026-10-19', '2026-10-25');
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      periodKey: '2026-10-19',
      performedOn: new Date('2026-10-25T00:00:00.000Z'),
    });
    await expect(register(coke, '2026-10-19', '2026-10-26')).rejects.toThrow('dentro del período');
    await expect(register(coke, '2026-10-19', '2026-10-18')).rejects.toThrow('dentro del período');
  });

  it('semana en curso: hasta hoy, nunca después', async () => {
    mocks.plans.mockResolvedValue([plan('WEEKLY', ar('2026-09-01'))]);
    await expect(register(coke, '2026-10-26', '2026-10-30')).resolves.toBeDefined();
    await expect(register(coke, '2026-10-26', '2026-11-01')).rejects.toThrow('futura');
  });

  it('quincena cerrada: del 1 al 15', async () => {
    mocks.plans.mockResolvedValue([plan('SEMI_MONTHLY', ar('2026-01-01'))]);
    await expect(register(coke, '2026-10-Q1', '2026-10-15')).resolves.toBeDefined();
    await expect(register(coke, '2026-10-Q1', '2026-10-16')).rejects.toThrow('dentro del período');
  });

  // El 10/01/2027 la ventana va del 12/12/2026 al 10/01/2027: entran la 2.ª quincena de
  // diciembre y el mes, el bimestre y el año que empiezan el 01/01 (los que ve Desempeño).
  const JANUARY = ar('2027-01-10');
  it.each([
    ['SEMI_MONTHLY', '2026-12-Q2', '2026-12-31', '2027-01-01'],
    ['MONTHLY', '2027-01-01', '2027-01-01', '2026-12-31'],
    ['BIMONTHLY', '2027-B1', '2027-01-05', '2026-12-31'],
    ['ANNUAL', '2027-A', '2027-01-10', '2026-12-31'],
  ] as const)(
    '%s %s (cambio de año): %s dentro, %s fuera',
    async (frequency, key, inside, outside) => {
      mocks.plans.mockResolvedValue([plan(frequency, ar('2026-01-01'))]);
      await expect(register(coke, key, inside, undefined, JANUARY)).resolves.toBeDefined();
      await expect(register(coke, key, outside, undefined, JANUARY)).rejects.toThrow(
        'dentro del período',
      );
      await expect(register(coke, key, '2027-01-11', undefined, JANUARY)).rejects.toThrow('futura');
    },
  );

  it('bimestre o año que empezaron antes de la ventana: no figuran en Desempeño → 409', async () => {
    mocks.plans.mockResolvedValue([plan('BIMONTHLY', ar('2026-01-01'))]);
    await expect(register(coke, '2026-B5', '2026-10-01')).rejects.toBeInstanceOf(
      TaskObligationUnavailableError,
    );
    mocks.plans.mockResolvedValue([plan('ANNUAL', ar('2026-01-01'))]);
    await expect(register(coke, '2026-A', '2026-10-01')).rejects.toBeInstanceOf(
      TaskObligationUnavailableError,
    );
  });

  it('anterior a que la tarea existiera → 400 con la primera fecha admitida', async () => {
    mocks.plans.mockResolvedValue([plan('WEEKLY', ar('2026-10-21', '10:00'))]);
    await expect(register(coke, '2026-10-19', '2026-10-20')).rejects.toThrow(
      'Ese día la tarea todavía no estaba planificada así. Elegí una fecha desde el 21/10/2026.',
    );
    await expect(register(coke, '2026-10-19', '2026-10-21')).resolves.toBeDefined();
  });

  it('período sin obligación (antes de crearla, fuera de la ventana o clave arbitraria) → 409', async () => {
    mocks.plans.mockResolvedValue([plan('DAILY', ar('2026-10-10'))]);
    for (const key of ['2026-10-05', '2026-09-30', '2026-10-Q1', '2026-10-31']) {
      await expect(register(coke, key, '2026-10-05')).rejects.toBeInstanceOf(
        TaskObligationUnavailableError,
      );
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('tarea inexistente → 404', async () => {
    mocks.taskFindUnique.mockResolvedValue(null);
    await expect(register(coke, '2026-10-29', '2026-10-29')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('carga olvidada — responsable y frecuencia históricos', () => {
  it('reasignada después: la obligación del 29 sigue siendo de Coke (no del responsable actual)', async () => {
    mocks.plans.mockResolvedValue([
      plan('DAILY', ar('2026-09-01'), ar('2026-10-30', '08:00'), COKE),
      plan('DAILY', ar('2026-10-30', '08:00'), null, JUAN),
    ]);
    await register(coke, '2026-10-29', '2026-10-29');
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      assignedEmployeeId: COKE,
      completedByEmployeeId: COKE,
    });
    // Juan (responsable actual) no puede atribuirse la obligación de Coke.
    await expect(register(juan, '2026-10-29', '2026-10-29')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('cambió de frecuencia después: la diaria del 29 conserva su clave diaria', async () => {
    mocks.plans.mockResolvedValue([
      plan('DAILY', ar('2026-09-01'), ar('2026-10-30', '08:00')),
      plan('WEEKLY', ar('2026-10-30', '08:00')),
    ]);
    await register(coke, '2026-10-29', '2026-10-29');
    expect(mocks.create.mock.calls[0]![0].data.periodKey).toBe('2026-10-29');
  });

  it('cambió de quincenal a semanal a mitad de semana: la semanal desde ese día; la quincena anterior conserva la suya', async () => {
    mocks.plans.mockResolvedValue([
      plan('SEMI_MONTHLY', ar('2026-09-01'), ar('2026-10-21', '12:00')),
      plan('WEEKLY', ar('2026-10-21', '12:00')),
    ]);
    await expect(register(coke, '2026-10-19', '2026-10-20')).rejects.toThrow(
      'Elegí una fecha desde el 21/10/2026.',
    );
    await register(coke, '2026-10-19', '2026-10-21');
    await register(coke, '2026-10-Q1', '2026-10-10');
    expect(mocks.create.mock.calls.map(([call]) => call.data.periodKey)).toEqual([
      '2026-10-19',
      '2026-10-Q1',
    ]);
    // La 2.ª quincena ya no es una obligación (en curso, decide la planificación semanal).
    await expect(register(coke, '2026-10-Q2', '2026-10-17')).rejects.toBeInstanceOf(
      TaskObligationUnavailableError,
    );
  });

  it('desactivada después: la carga de cuando estaba planificada sigue siendo válida', async () => {
    mocks.plans.mockResolvedValue([plan('DAILY', ar('2026-09-01'), ar('2026-10-30', '08:00'))]);
    await expect(register(coke, '2026-10-29', '2026-10-29')).resolves.toBeDefined();
  });
});

describe('carga olvidada — permisos', () => {
  it('EMPLOYEE no registra por otra persona (ni siquiera lo intenta en la base)', async () => {
    await expect(register(coke, '2026-10-29', '2026-10-29', JUAN)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(mocks.plans).not.toHaveBeenCalled();
  });

  it('EMPLOYEE no se atribuye una obligación ajena', async () => {
    mocks.plans.mockResolvedValue([plan('DAILY', ar('2026-09-01'), null, JUAN)]);
    await expect(register(coke, '2026-10-29', '2026-10-29')).rejects.toThrow(
      'Solo podés registrar tareas que te correspondían a vos.',
    );
  });

  it('EMPLOYEE sin empleado activo → 403', async () => {
    await expect(
      register({ ...coke, employeeId: null } as unknown as typeof coke, '2026-10-29', '2026-10-29'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('ADMIN debe elegir quién la realizó', async () => {
    await expect(register(admin, '2026-10-29', '2026-10-29')).rejects.toThrow(
      'Indicá quién realizó la tarea.',
    );
  });

  it('ADMIN registra que Juan cubrió la de Coke: cobertura, autor = el ADMIN', async () => {
    const result = await register(admin, '2026-10-29', '2026-10-29', JUAN);
    expect(mocks.employeeFindUnique).toHaveBeenCalledWith({
      where: { id: JUAN },
      select: { active: true },
    });
    expect(mocks.create.mock.calls[0]![0].data).toMatchObject({
      assignedEmployeeId: COKE,
      completedByEmployeeId: JUAN,
      recordedByUserId: 'u-admin',
    });
    expect(mocks.audit.mock.calls[0]![0].data.newState).toMatchObject({
      actorRole: 'ADMIN',
      registeredOnBehalf: true,
    });
    expect(result.completion.status).toBe('covered');
  });

  it('ADMIN no puede elegir a una persona inactiva', async () => {
    mocks.employeeFindUnique.mockResolvedValue({ active: false });
    await expect(register(admin, '2026-10-29', '2026-10-29', JUAN)).rejects.toThrow(
      'El empleado indicado no existe o no está activo.',
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
