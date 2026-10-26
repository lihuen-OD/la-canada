import { describe, expect, it } from 'vitest';
import type { GardenActivity, GardenPerformanceResponse } from '../../api/kitchenGardenTypes';
import { toPerformance, toTaskItem } from './gardenAdapters';

/** Solo traducción de nombres de campo: nada se calcula ni se inventa. Datos sintéticos. */
const P = { id: 'p1', displayName: 'Pablo sintético', colorHex: null };
const A = { id: 'p2', displayName: 'Admin sintética', colorHex: '#4a7c59' };

describe('adaptadores de la Huerta', () => {
  it('actividad → fila de presentación: responsable, asignada a y realizada por', () => {
    const activity: GardenActivity = {
      id: 'a1',
      description: 'Regar',
      frequency: 'DAILY',
      active: true,
      responsible: { ...P, active: true },
      periodKey: '2026-10-27',
      scheduledDate: null,
      scheduleStatus: null,
      executionOrder: 3,
      suggestedWeekday: null,
      suggestedFirstHalfDay: null,
      suggestedSecondHalfDay: null,
      suggestedMonthDay: null,
      suggestedMonth: null,
      suggestedDate: null,
      currentExecution: {
        id: 'x1',
        periodKey: '2026-10-27',
        completedAt: '2026-10-27T12:00:00.000Z',
        assignedTo: P,
        completedBy: A,
        canRevert: true,
      },
      canComplete: false,
    };
    const item = toTaskItem(activity);
    expect(item.assignee).toEqual({
      id: 'p1',
      displayName: 'Pablo sintético',
      colorHex: '',
      active: true,
    });
    expect(item.currentExecution).toMatchObject({
      assignedEmployee: { id: 'p1' },
      completedByEmployee: { id: 'p2', displayName: 'Admin sintética' },
      canRevert: true,
    });
    expect(item).toMatchObject({ executionOrder: 3, canComplete: false });
  });

  it('desempeño: participantes → filas por persona, con las mismas métricas del backend', () => {
    const response: GardenPerformanceResponse = {
      range: {
        from: '2026-10-21',
        to: '2026-10-27',
        timeZone: 'America/Argentina/Buenos_Aires',
        includesCurrentDay: true,
        maxDays: 30,
      },
      scope: 'team',
      team: {
        assigned: 2,
        completedPersonally: 1,
        percentage: 50,
        pending: 1,
        coverageReceived: 0,
        coverageGiven: 0,
        operationalCompleted: 1,
      },
      special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 0 },
      participants: [
        {
          participant: { ...P, roleLabel: 'Jardinero', active: true },
          assigned: 2,
          completedPersonally: 1,
          percentage: 50,
          pending: 1,
          coverageReceived: 0,
          coverageGiven: 0,
          operationalCompleted: 1,
        },
      ],
      occurrences: [
        {
          activityId: 'a1',
          description: 'Regar',
          frequency: 'DAILY',
          status: 'covered',
          periodKey: '2026-10-26',
          assignedParticipantId: 'p1',
          completedByParticipantId: 'p2',
          assignedTo: P,
          completedBy: null,
          completedAt: '2026-10-26T12:00:00.000Z',
        },
      ],
    };
    const adapted = toPerformance(response);
    expect(adapted.employees[0]).toMatchObject({
      employee: { id: 'p1', role: 'Jardinero' },
      assigned: 2,
      percentage: 50,
    });
    expect(adapted.occurrences?.[0]).toMatchObject({
      taskId: 'a1',
      assignedEmployeeId: 'p1',
      completedByEmployeeId: 'p2',
      completed: true,
      completedByEmployee: null,
    });
    expect(adapted.team).toBe(response.team);
  });
});
