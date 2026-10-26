import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Orden del listado operativo (`listTasks`, con Prisma simulado), dentro de
 * cada frecuencia y sin mezclarlas:
 * - diarias y urgentes: orden de realización ascendente, sin número al final;
 * - las demás: primero las que tienen fecha (la más antigua arriba; «Una vez»:
 *   su fecha para realizar, recurrentes: la fecha sugerida del período
 *   vigente), con la misma fecha por número; después las sin fecha, por
 *   número; sin número, después de las numeradas.
 * En empates, descripción y un desempate estable por id. Las tareas sin orden
 * ni fecha quedan como antes.
 */
const mocks = vi.hoisted(() => ({ tasks: vi.fn(), executions: vi.fn() }));
vi.mock('../../lib/prisma', () => ({
  prisma: {
    task: { findMany: mocks.tasks },
    taskExecution: { findMany: mocks.executions },
  },
}));

import { listTasks } from '../../tasks/tasksService';

const admin = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const NOW = new Date('2026-10-26T15:00:00.000Z'); // lunes 26/10 12:00 AR
const employee = { id: 'e-1', displayName: 'Persona sintética', colorHex: '#4a7c59', active: true };
let id = 0;
const row = (
  description: string,
  frequency: string,
  extra: Partial<Record<string, unknown>> = {},
) => ({
  id: `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  description,
  frequency,
  active: true,
  scheduledDate: null,
  executionOrder: null,
  suggestedWeekday: null,
  suggestedFirstHalfDay: null,
  suggestedSecondHalfDay: null,
  suggestedMonthDay: null,
  suggestedMonth: null,
  employee,
  ...extra,
});

beforeEach(() => {
  id = 0;
  mocks.tasks.mockReset();
  mocks.executions.mockResolvedValue([]);
});

const names = async () =>
  (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.description);

describe('orden de realización', () => {
  it('sin orden en ninguna tarea: exactamente el orden anterior (frecuencia y descripción)', async () => {
    mocks.tasks.mockResolvedValue([
      row('Mensual B', 'MONTHLY'),
      row('Diaria Z', 'DAILY'),
      row('Urgente', 'URGENT'),
      row('Diaria A', 'DAILY'),
      row('Semanal', 'WEEKLY'),
    ]);
    expect(await names()).toEqual(['Urgente', 'Diaria A', 'Diaria Z', 'Semanal', 'Mensual B']);
  });

  it('dentro de cada frecuencia: numeradas ascendentes, repetidas por descripción, después las sin orden', async () => {
    mocks.tasks.mockResolvedValue([
      row('Diaria sin orden A', 'DAILY'),
      row('Diaria orden 2 B', 'DAILY', { executionOrder: 2 }),
      row('Diaria orden 10', 'DAILY', { executionOrder: 10 }),
      row('Diaria orden 2 A', 'DAILY', { executionOrder: 2 }),
      row('Diaria orden 1', 'DAILY', { executionOrder: 1 }),
      row('Diaria sin orden B', 'DAILY'),
      row('Semanal orden 1', 'WEEKLY', { executionOrder: 1 }),
      row('Urgente orden 5', 'URGENT', { executionOrder: 5 }),
    ]);
    expect(await names()).toEqual([
      'Urgente orden 5',
      'Diaria orden 1',
      'Diaria orden 2 A',
      'Diaria orden 2 B',
      'Diaria orden 10',
      'Diaria sin orden A',
      'Diaria sin orden B',
      'Semanal orden 1',
    ]);
  });

  it('empate total (misma descripción, otro responsable): desempate estable por id, sin importar el orden de llegada', async () => {
    const first = row('Regar', 'DAILY', { executionOrder: 3 });
    const second = row('Regar', 'DAILY', {
      executionOrder: 3,
      employee: { ...employee, id: 'e-2' },
    });
    mocks.tasks.mockResolvedValue([second, first]);
    const a = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    mocks.tasks.mockResolvedValue([first, second]);
    const b = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    expect(a).toEqual([first.id, second.id]);
    expect(b).toEqual(a);
  });

  it('el DTO trae el orden, la sugerencia y la fecha sugerida del período (solo informativa)', async () => {
    mocks.tasks.mockResolvedValue([
      row('Semanal', 'WEEKLY', { executionOrder: 4, suggestedWeekday: 3 }),
      row('Diaria', 'DAILY'),
    ]);
    const { tasks } = await listTasks(admin, { status: 'active' }, NOW);
    expect(tasks.find((task) => task.description === 'Semanal')).toMatchObject({
      executionOrder: 4,
      suggestedWeekday: 3,
      suggestedDate: '2026-10-28',
      canComplete: true,
      scheduleStatus: null,
    });
    expect(tasks.find((task) => task.description === 'Diaria')).toMatchObject({
      executionOrder: null,
      suggestedDate: null,
    });
  });
});

/** «Una vez» con fecha para realizar `YYYY-MM-DD`. */
const on = (day: string) => ({ scheduledDate: new Date(`${day}T00:00:00Z`) });

describe('fecha antes que número', () => {
  // Las descripciones van al revés del resultado esperado: nunca deciden el orden.
  it.each([
    ['«Una vez» (fecha para realizar)', 'ONE_TIME', (day: number) => on(`2027-01-${day}`)],
    [
      'anual (fecha sugerida del período)',
      'ANNUAL',
      (day: number) => ({ suggestedMonth: 1, suggestedMonthDay: day }),
    ],
  ])(
    'caso obligatorio — %s: 15/01 orden 2, 19/01 orden 1, 19/01 orden 3, sin fecha orden 1',
    async (_label, frequency, dated) => {
      mocks.tasks.mockResolvedValue([
        row('A sin fecha orden 1', frequency, { executionOrder: 1 }),
        row('B 19/01 orden 3', frequency, { ...dated(19), executionOrder: 3 }),
        row('C 19/01 orden 1', frequency, { ...dated(19), executionOrder: 1 }),
        row('D 15/01 orden 2', frequency, { ...dated(15), executionOrder: 2 }),
      ]);
      expect(await names()).toEqual([
        'D 15/01 orden 2',
        'C 19/01 orden 1',
        'B 19/01 orden 3',
        'A sin fecha orden 1',
      ]);
    },
  );

  it('fecha u orden vacíos: con fecha primero (misma fecha: numeradas y después sin número), luego sin fecha por número', async () => {
    mocks.tasks.mockResolvedValue([
      row('A sin fecha sin orden', 'MONTHLY'),
      row('B sin fecha orden 3', 'MONTHLY', { executionOrder: 3 }),
      row('C día 5 sin orden', 'MONTHLY', { suggestedMonthDay: 5 }),
      row('D día 31 orden 1', 'MONTHLY', { suggestedMonthDay: 31, executionOrder: 1 }),
      row('E día 5 orden 9', 'MONTHLY', { suggestedMonthDay: 5, executionOrder: 9 }),
    ]);
    expect(await names()).toEqual([
      'E día 5 orden 9',
      'C día 5 sin orden',
      'D día 31 orden 1',
      'B sin fecha orden 3',
      'A sin fecha sin orden',
    ]);
  });

  it('recurrentes: cuenta la fecha sugerida del período VIGENTE (quincena sin sugerencia = sin fecha)', async () => {
    // Lunes 26/10: 2.ª quincena y semana del 26/10.
    mocks.tasks.mockResolvedValue([
      row('Semanal viernes orden 1', 'WEEKLY', { suggestedWeekday: 5, executionOrder: 1 }),
      row('Semanal sin sugerencia orden 1', 'WEEKLY', { executionOrder: 1 }),
      row('Semanal miércoles sin orden', 'WEEKLY', { suggestedWeekday: 3 }),
      row('Semanal miércoles orden 2', 'WEEKLY', { suggestedWeekday: 3, executionOrder: 2 }),
      row('Quincenal solo 1.ª quincena orden 1', 'SEMI_MONTHLY', {
        suggestedFirstHalfDay: 3,
        executionOrder: 1,
      }),
      row('Quincenal día 20 orden 5', 'SEMI_MONTHLY', {
        suggestedSecondHalfDay: 20,
        executionOrder: 5,
      }),
    ]);
    const { tasks } = await listTasks(admin, { status: 'active' }, NOW);
    expect(tasks.map((task) => [task.description, task.suggestedDate])).toEqual([
      ['Semanal miércoles orden 2', '2026-10-28'],
      ['Semanal miércoles sin orden', '2026-10-28'],
      ['Semanal viernes orden 1', '2026-10-30'],
      ['Semanal sin sugerencia orden 1', null],
      ['Quincenal día 20 orden 5', '2026-10-20'],
      ['Quincenal solo 1.ª quincena orden 1', null],
    ]);
  });

  it('desempates: misma fecha y número → descripción; empate total → id, sin importar el orden de llegada', async () => {
    const first = row('Podar', 'BIMONTHLY', {
      suggestedMonth: 2,
      suggestedMonthDay: 3,
      executionOrder: 4,
    });
    const second = row('Podar', 'BIMONTHLY', {
      suggestedMonth: 2,
      suggestedMonthDay: 3,
      executionOrder: 4,
      employee: { ...employee, id: 'e-2' },
    });
    const byName = row('Árboles', 'BIMONTHLY', {
      suggestedMonth: 2,
      suggestedMonthDay: 3,
      executionOrder: 4,
    });
    mocks.tasks.mockResolvedValue([second, first, byName]);
    const a = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    mocks.tasks.mockResolvedValue([byName, first, second]);
    const b = (await listTasks(admin, { status: 'active' }, NOW)).tasks.map((task) => task.id);
    expect(a).toEqual([byName.id, first.id, second.id]);
    expect(b).toEqual(a);
  });

  it('diarias y urgentes: solo por número (sin número al final); las urgentes conservan su precedencia', async () => {
    mocks.tasks.mockResolvedValue([
      row('A diaria sin orden', 'DAILY'),
      row('B diaria orden 3', 'DAILY', { executionOrder: 3 }),
      row('C diaria orden 1', 'DAILY', { executionOrder: 1 }),
      row('D única con fecha', 'ONE_TIME', on('2026-10-20')),
      row('E urgente sin orden', 'URGENT'),
      row('F urgente orden 2', 'URGENT', { executionOrder: 2 }),
      row('G urgente orden 1', 'URGENT', { executionOrder: 1 }),
    ]);
    expect(await names()).toEqual([
      'G urgente orden 1',
      'F urgente orden 2',
      'E urgente sin orden',
      'D única con fecha',
      'C diaria orden 1',
      'B diaria orden 3',
      'A diaria sin orden',
    ]);
  });

  it('agrupación conservada: una fecha más antigua nunca saca a una tarea de su frecuencia', async () => {
    mocks.tasks.mockResolvedValue([
      row('Anual 15/01', 'ANNUAL', { suggestedMonth: 1, suggestedMonthDay: 15 }),
      row('Bimestral 10/09', 'BIMONTHLY', { suggestedMonth: 1, suggestedMonthDay: 10 }),
      row('Mensual 31/10', 'MONTHLY', { suggestedMonthDay: 31 }),
      row('Quincenal 20/10', 'SEMI_MONTHLY', { suggestedSecondHalfDay: 20 }),
      row('Semanal 30/10', 'WEEKLY', { suggestedWeekday: 5 }),
      row('Diaria', 'DAILY', { executionOrder: 1 }),
      row('Única 2030', 'ONE_TIME', on('2030-01-01')),
      row('Urgente', 'URGENT'),
    ]);
    expect(await names()).toEqual([
      'Urgente',
      'Única 2030',
      'Diaria',
      'Semanal 30/10',
      'Quincenal 20/10',
      'Mensual 31/10',
      'Bimestral 10/09',
      'Anual 15/01',
    ]);
  });

  it('nunca ordena por estado ni cumplimiento: completada, desactivada y pendiente quedan por fecha', async () => {
    const done = row('C lunes completada', 'WEEKLY', { suggestedWeekday: 1 });
    mocks.tasks.mockResolvedValue([
      row('A viernes pendiente', 'WEEKLY', { suggestedWeekday: 5 }),
      row('B miércoles desactivada', 'WEEKLY', { suggestedWeekday: 3, active: false }),
      done,
    ]);
    mocks.executions.mockResolvedValue([
      {
        id: 'x-1',
        taskId: done.id,
        periodKey: '2026-10-26',
        completedAt: NOW,
        recordedByUserId: 'u-admin',
        assignedEmployee: employee,
        completedByEmployee: employee,
      },
    ]);
    const { tasks } = await listTasks(admin, { status: 'all' }, NOW);
    expect(tasks.map((task) => task.description)).toEqual([
      'C lunes completada',
      'B miércoles desactivada',
      'A viernes pendiente',
    ]);
    expect(tasks[0]?.currentExecution).not.toBeNull();
  });

  it('con filtro de persona y frecuencia: la base filtra y el listado aplica el mismo criterio', async () => {
    mocks.tasks.mockResolvedValue([
      row('A sin fecha orden 1', 'ONE_TIME', { executionOrder: 1 }),
      row('B 19/01 orden 1', 'ONE_TIME', { ...on('2027-01-19'), executionOrder: 1 }),
      row('C 15/01 orden 2', 'ONE_TIME', { ...on('2027-01-15'), executionOrder: 2 }),
    ]);
    const filters = { status: 'active', employeeId: 'e-1', frequency: 'ONE_TIME' } as const;
    const { tasks } = await listTasks(admin, filters, NOW);
    expect(mocks.tasks.mock.calls[0]?.[0].where).toEqual({
      active: true,
      employeeId: 'e-1',
      frequency: 'ONE_TIME',
    });
    expect(tasks.map((task) => task.description)).toEqual([
      'C 15/01 orden 2',
      'B 19/01 orden 1',
      'A sin fecha orden 1',
    ]);
  });
});
