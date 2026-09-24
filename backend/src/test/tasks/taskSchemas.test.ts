import { describe, expect, it } from 'vitest';
import {
  completeTaskBodySchema,
  createTaskBodySchema,
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
});
