import { describe, expect, it, vi } from 'vitest';

const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }));
vi.mock('../../lib/prisma', () => ({ prisma: { user: { findUnique: findUniqueMock } } }));

import { resolveActor } from '../../tasks/tasksService';

describe('resolveActor — Etapa 5P: sin consulta extra por request', () => {
  it('reutiliza el empleado que requireAuth ya resolvió en su consulta única', async () => {
    const actor = await resolveActor({
      userId: 'u-1',
      sessionId: 's-1',
      role: 'EMPLOYEE',
      employeeId: 'e-1',
    });
    expect(actor).toEqual({ userId: 'u-1', role: 'EMPLOYEE', employeeId: 'e-1' });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('sin employeeId en el contexto (armado a mano) consulta como antes', async () => {
    findUniqueMock.mockResolvedValueOnce({ employee: { id: 'e-2', active: true } });
    const actor = await resolveActor({ userId: 'u-2', sessionId: 's-2', role: 'EMPLOYEE' });
    expect(actor.employeeId).toBe('e-2');
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });
});
