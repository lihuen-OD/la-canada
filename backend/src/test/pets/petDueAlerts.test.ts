import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🐾 Atenciones de mascotas en Inicio (`getPetDueAlerts`) con un Prisma
 * simulado: la condición que llega a la base (la misma regla de 📅
 * Vencimientos, solo mascotas activas y hasta el fin de la ventana de 30
 * días), el orden y el límite aplicados en la consulta (antes de limitar), los
 * totales de TODA la ventana clasificados con `computeDueStatus` y un DTO sin
 * campos de más. La SQL real se prueba contra `demo` en
 * `petDueHome.integration.test.ts`.
 */
const db = vi.hoisted(() => ({
  animalMedicalRecord: { groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { getPetDueAlerts, PET_DUE_ALERTS_LIMIT } from '../../pets/petService';

const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, employeeId: null };
const EMPLOYEE = { userId: 'u-emp', role: 'EMPLOYEE' as const, employeeId: 'e-1' };
/** Lunes 26/10/2026 12:00 en Buenos Aires. */
const NOW = new Date('2026-10-26T15:00:00.000Z');
const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const group = (date: string, count: number) => ({
  nextDueDate: day(date),
  _count: { _all: count },
});

beforeEach(() => {
  db.animalMedicalRecord.groupBy.mockReset().mockResolvedValue([]);
  db.animalMedicalRecord.findMany.mockReset().mockResolvedValue([]);
});

describe('getPetDueAlerts', () => {
  it('consulta solo pendientes abiertos de mascotas activas hasta hoy + 30, ordena y limita en la base', async () => {
    await getPetDueAlerts(ADMIN, NOW);
    const where = {
      voidedAt: null,
      nextDueDate: { not: null, lte: day('2026-11-25') },
      fulfillments: { none: { voidedAt: null } },
      animal: { active: true },
    };
    expect(db.animalMedicalRecord.groupBy).toHaveBeenCalledWith({
      by: ['nextDueDate'],
      where,
      _count: { _all: true },
    });
    expect(db.animalMedicalRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ nextDueDate: 'asc' }, { recordDate: 'asc' }, { id: 'asc' }],
        take: PET_DUE_ALERTS_LIMIT,
      }),
    );
    expect(PET_DUE_ALERTS_LIMIT).toBe(5);
  });

  it('totales de toda la ventana: vencidas antiguas y de ayer, hoy, mañana y día 30; nada a 31 días', async () => {
    db.animalMedicalRecord.groupBy.mockResolvedValue([
      group('2025-01-10', 2), // vencidas antiguas
      group('2026-10-25', 1), // ayer
      group('2026-10-26', 3), // hoy
      group('2026-10-27', 1), // mañana
      group('2026-11-25', 4), // día 30
      group('2026-11-26', 9), // día 31 (no debería llegar; si llegara, no se cuenta)
    ]);
    const { counts } = await getPetDueAlerts(ADMIN, NOW);
    expect(counts).toEqual({ overdue: 3, dueToday: 3, upcoming: 5 });
  });

  it('el cambio de día es el de BUSINESS_TIME_ZONE: 23:59 y 00:00 de Buenos Aires', async () => {
    db.animalMedicalRecord.groupBy.mockResolvedValue([group('2026-10-27', 1)]);
    db.animalMedicalRecord.findMany.mockResolvedValue([
      {
        id: 'r1',
        type: 'CHECKUP',
        description: null,
        nextDueDate: day('2026-10-27'),
        animal: { id: 'p1', name: 'Mascota sintética' },
      },
    ]);
    // 26/10 23:59 en Buenos Aires = 27/10 02:59 UTC: todavía es «mañana».
    const before = await getPetDueAlerts(ADMIN, new Date('2026-10-27T02:59:00.000Z'));
    expect(before.counts).toEqual({ overdue: 0, dueToday: 0, upcoming: 1 });
    expect(before.items[0]?.nextDue).toEqual({
      date: '2026-10-27',
      status: 'UPCOMING',
      daysUntil: 1,
    });
    // 27/10 00:00 en Buenos Aires: vence hoy.
    const after = await getPetDueAlerts(ADMIN, new Date('2026-10-27T03:00:00.000Z'));
    expect(after.counts).toEqual({ overdue: 0, dueToday: 1, upcoming: 0 });
    expect(after.items[0]?.nextDue).toEqual({
      date: '2026-10-27',
      status: 'DUE_TODAY',
      daysUntil: 0,
    });
  });

  it('filas: dos atenciones del mismo tipo de una mascota quedan separadas; DTO solo con lo que muestra la tarjeta', async () => {
    db.animalMedicalRecord.findMany.mockResolvedValue([
      {
        id: 'r1',
        type: 'VACCINE',
        description: 'Antirrábica',
        nextDueDate: day('2026-10-20'),
        animal: { id: 'p1', name: 'Mascota sintética' },
      },
      {
        id: 'r2',
        type: 'VACCINE',
        description: 'Séxtuple',
        nextDueDate: day('2026-10-20'),
        animal: { id: 'p1', name: 'Mascota sintética' },
      },
    ]);
    const { items } = await getPetDueAlerts(EMPLOYEE, NOW);
    expect(items).toEqual([
      {
        record: { id: 'r1', type: 'VACCINE', description: 'Antirrábica' },
        pet: { id: 'p1', name: 'Mascota sintética' },
        nextDue: { date: '2026-10-20', status: 'OVERDUE', daysUntil: -6 },
      },
      {
        record: { id: 'r2', type: 'VACCINE', description: 'Séxtuple' },
        pet: { id: 'p1', name: 'Mascota sintética' },
        nextDue: { date: '2026-10-20', status: 'OVERDUE', daysUntil: -6 },
      },
    ]);
  });

  it('el rol no cambia nada: ADMIN y EMPLOYEE reciben la misma consulta', async () => {
    await getPetDueAlerts(ADMIN, NOW);
    await getPetDueAlerts(EMPLOYEE, NOW);
    const [first, second] = db.animalMedicalRecord.findMany.mock.calls;
    expect(second).toEqual(first);
  });
});
