import { describe, expect, it } from 'vitest';
import {
  completeTaskBodySchema,
  createTaskBodySchema,
  lateCompletionBodySchema,
  listTasksQuerySchema,
  revertTaskBodySchema,
  taskHistoryQuerySchema,
  updateTaskBodySchema,
} from '../../tasks/taskSchemas';

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111';

describe('taskSchemas', () => {
  it('normaliza espacios de la descripción', () => {
    const parsed = createTaskBodySchema.parse({
      description: '  Regar   las\n plantas  ',
      employeeId: EMPLOYEE_ID,
      frequency: 'DAILY',
    });
    expect(parsed.description).toBe('Regar las plantas');
  });

  it.each([
    ['vacía', '   '],
    ['muy corta', 'ab'],
    ['demasiado larga', 'x'.repeat(201)],
    ['con HTML', '<b>Regar</b>'],
    ['con caracteres de control', `Regar${String.fromCharCode(0)} plantas`],
  ])('rechaza una descripción %s', (_label, description) => {
    expect(
      createTaskBodySchema.safeParse({ description, employeeId: EMPLOYEE_ID, frequency: 'DAILY' })
        .success,
    ).toBe(false);
  });

  it('acepta SEMI_MONTHLY al crear, editar y filtrar; rechaza sinónimos que no son el enum', () => {
    const base = { description: 'Limpiar canaletas', employeeId: EMPLOYEE_ID };
    expect(createTaskBodySchema.parse({ ...base, frequency: 'SEMI_MONTHLY' }).frequency).toBe(
      'SEMI_MONTHLY',
    );
    expect(updateTaskBodySchema.parse({ frequency: 'SEMI_MONTHLY' })).toEqual({
      frequency: 'SEMI_MONTHLY',
    });
    expect(listTasksQuerySchema.parse({ frequency: 'SEMI_MONTHLY' }).frequency).toBe(
      'SEMI_MONTHLY',
    );
    for (const frequency of ['BIWEEKLY', 'quincenal', 'FORTNIGHTLY'])
      expect(createTaskBodySchema.safeParse({ ...base, frequency }).success).toBe(false);
  });

  it('rechaza frecuencias fuera del enum real y UUID inválidos', () => {
    expect(
      createTaskBodySchema.safeParse({
        description: 'Regar',
        employeeId: EMPLOYEE_ID,
        frequency: 'diaria',
      }).success,
    ).toBe(false);
    expect(
      createTaskBodySchema.safeParse({
        description: 'Regar',
        employeeId: 'abc',
        frequency: 'DAILY',
      }).success,
    ).toBe(false);
  });

  it('crear no acepta campos extra (p. ej. active o id)', () => {
    expect(
      createTaskBodySchema.safeParse({
        description: 'Regar',
        employeeId: EMPLOYEE_ID,
        frequency: 'DAILY',
        active: false,
      }).success,
    ).toBe(false);
  });

  it('editar exige al menos un cambio y no acepta active (tiene endpoint propio)', () => {
    expect(updateTaskBodySchema.safeParse({}).success).toBe(false);
    expect(updateTaskBodySchema.safeParse({ active: false }).success).toBe(false);
    expect(updateTaskBodySchema.safeParse({ frequency: 'WEEKLY' }).success).toBe(true);
  });

  it('completar no acepta completedByEmployeeId, periodKey ni otros campos', () => {
    expect(completeTaskBodySchema.safeParse({}).success).toBe(true);
    expect(completeTaskBodySchema.safeParse({ completedByEmployeeId: EMPLOYEE_ID }).success).toBe(
      false,
    );
    expect(completeTaskBodySchema.safeParse({ periodKey: '2026-09-24' }).success).toBe(false);
  });

  it('revertir exige executionId y valida el motivo', () => {
    expect(revertTaskBodySchema.safeParse({}).success).toBe(false);
    expect(revertTaskBodySchema.safeParse({ executionId: EMPLOYEE_ID }).success).toBe(true);
    expect(
      revertTaskBodySchema.safeParse({ executionId: EMPLOYEE_ID, reason: 'x'.repeat(301) }).success,
    ).toBe(false);
  });

  it('filtros: status por defecto active; valores desconocidos rechazados', () => {
    expect(listTasksQuerySchema.parse({}).status).toBe('active');
    expect(listTasksQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(taskHistoryQuerySchema.safeParse({ week: '2026/09/21' }).success).toBe(false);
  });

  describe('lateCompletionBodySchema (carga olvidada)', () => {
    it.each(['2026-10-29', '2026-10-26', '2026-10-Q1', '2026-10-Q2', '2026-B5', '2026-A'])(
      'acepta el período %s con su fecha real',
      (periodKey) => {
        expect(
          lateCompletionBodySchema.safeParse({ periodKey, performedOn: '2026-10-29' }).success,
        ).toBe(true);
      },
    );

    it.each(['URGENT', 'ONE_TIME', '2026-10', '2026-10-Q3', '2026-B7', '29/10/2026', ''])(
      'rechaza el período %s',
      (periodKey) => {
        expect(
          lateCompletionBodySchema.safeParse({ periodKey, performedOn: '2026-10-29' }).success,
        ).toBe(false);
      },
    );

    it.each(['2026-02-30', '29/10/2026', '2026-10-29T10:00', ''])(
      'rechaza la fecha %s (sin hora y real)',
      (performedOn) => {
        expect(
          lateCompletionBodySchema.safeParse({ periodKey: '2026-10-29', performedOn }).success,
        ).toBe(false);
      },
    );

    it.each([
      ['assignedEmployeeId', EMPLOYEE_ID],
      ['frequency', 'DAILY'],
      ['status', 'pending'],
      ['completedAt', '2026-10-29T10:00:00Z'],
      ['completedByEmployeeId', EMPLOYEE_ID],
    ])('no acepta %s del cliente (strict)', (field, value) => {
      expect(
        lateCompletionBodySchema.safeParse({
          periodKey: '2026-10-29',
          performedOn: '2026-10-29',
          [field]: value,
        }).success,
      ).toBe(false);
    });

    it('employeeId solo como UUID', () => {
      expect(
        lateCompletionBodySchema.safeParse({
          periodKey: '2026-10-29',
          performedOn: '2026-10-29',
          employeeId: 'coke',
        }).success,
      ).toBe(false);
    });
  });
});
