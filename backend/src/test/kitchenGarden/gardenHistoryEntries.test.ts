import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🥬 Huerta → 📅 Historial cronológico con Prisma simulado: rango por
 * defecto (30 días de negocio), rango propio y «todo», filtros traducidos a
 * la consulta (texto literal, tipo, «Sin clasificar», persona, deshechas),
 * cursor estable, quién registró solo si es otra persona y reversión solo
 * cuando la permiten las reglas de siempre. La SQL real, contra `demo`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    kitchenGardenParticipant: { findMany: fn() },
    kitchenGardenExecution: { findMany: fn() },
    user: { findMany: fn() },
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  escapeLike,
  listGardenHistoryEntries,
} from '../../kitchenGarden/gardenHistoryEntries';
import { gardenHistoryEntriesQuerySchema } from '../../kitchenGarden/gardenSchemas';

const P = '00000000-0000-4000-8000-0000000000a1';
const Q = '00000000-0000-4000-8000-0000000000a2';
const ADMIN = { userId: 'u-admin', role: 'ADMIN' as const, participantId: null };
const PABLO = { userId: 'u-pablo', role: 'EMPLOYEE' as const, participantId: P };
// Lunes 02/11/2026 a las 12:00 de Argentina.
const NOW = new Date('2026-11-02T15:00:00.000Z');

const directoryRow = (id: string, name: string) => ({
  id,
  active: true,
  createdAt: NOW,
  user: {
    role: 'EMPLOYEE',
    status: 'ACTIVE',
    employee: { displayName: name, colorHex: null, role: 'Jardinero' },
    personalProfile: null,
  },
});

let seq = 0;
function executionRow(extra: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-00000000f${String(seq).padStart(3, '0')}`,
    periodKey: 'ONE_TIME',
    completedAt: new Date(NOW.getTime() - seq * 3_600_000),
    assignedParticipantId: P,
    completedByParticipantId: P,
    recordedByUserId: 'u-pablo',
    revertedAt: null,
    revertedByUserId: null,
    revertReason: null,
    activity: {
      id: 'act-1',
      description: 'Sembrar LECHUGA sintética',
      kind: 'SOWING',
      frequency: 'ONE_TIME',
      active: true,
    },
    ...extra,
  };
}

const whereOf = () =>
  db.kitchenGardenExecution.findMany.mock.calls[0]![0].where as Record<string, unknown>;

beforeEach(() => {
  seq = 0;
  for (const group of Object.values(db))
    for (const method of Object.values(group)) method.mockReset();
  db.kitchenGardenParticipant.findMany.mockResolvedValue([
    directoryRow(P, 'Pablo sintético'),
    directoryRow(Q, 'Persona sintética Q'),
  ]);
  db.kitchenGardenExecution.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([
    {
      id: 'u-pablo',
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      employee: { displayName: 'Pablo sintético', colorHex: null, role: 'Jardinero' },
      personalProfile: null,
      kitchenGardenParticipant: { id: P },
    },
    {
      id: 'u-admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      employee: null,
      personalProfile: { displayName: 'Admin sintética' },
      kitchenGardenParticipant: null,
    },
  ]);
});

describe('rango', () => {
  it('por defecto, los últimos 30 días de negocio (hoy incluido), sin pedir la semana', async () => {
    const result = await listGardenHistoryEntries(PABLO, {}, NOW);
    expect(result.range).toMatchObject({ mode: 'recent', from: '2026-10-04', to: '2026-11-02' });
    expect(whereOf()).toMatchObject({
      revertedAt: null,
      AND: [
        {
          completedAt: {
            gte: new Date('2026-10-04T03:00:00.000Z'),
            lt: new Date('2026-11-03T03:00:00.000Z'),
          },
        },
      ],
    });
  });

  it('el domingo 23:30 de Argentina (lunes en UTC) el rango todavía termina el domingo', async () => {
    const result = await listGardenHistoryEntries(PABLO, {}, new Date('2026-11-02T02:30:00.000Z'));
    expect(result.range).toMatchObject({ from: '2026-10-03', to: '2026-11-01' });
  });

  it('«Todo el historial» no acota fechas; un rango propio admite un solo extremo', async () => {
    await listGardenHistoryEntries(PABLO, { all: true }, NOW);
    expect(whereOf()).not.toHaveProperty('AND');
    db.kitchenGardenExecution.findMany.mockClear();
    const result = await listGardenHistoryEntries(PABLO, { from: '2026-06-01' }, NOW);
    expect(result.range).toMatchObject({ mode: 'custom', from: '2026-06-01', to: null });
    expect(whereOf()).toMatchObject({
      AND: [{ completedAt: { gte: new Date('2026-06-01T03:00:00.000Z') } }],
    });
  });

  it.each([
    [{ from: '2026-11-02', to: '2026-11-01' }, 'posterior'],
    [{ all: true, from: '2026-11-01' }, 'no las dos'],
    [{ from: '2026-02-30' }, 'no es válida'],
  ])('%o → 400 sin consultar', async (params, message) => {
    await expect(listGardenHistoryEntries(PABLO, params, NOW)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining(message),
    });
    expect(db.kitchenGardenExecution.findMany).not.toHaveBeenCalled();
  });
});

describe('filtros (en la base)', () => {
  it('texto literal (sin comodines), tipo, persona y deshechas a pedido', async () => {
    await listGardenHistoryEntries(
      PABLO,
      { q: '50%_x', kind: 'TRANSPLANT', participantId: Q, includeReverted: true, all: true },
      NOW,
    );
    expect(whereOf()).toEqual({
      completedByParticipantId: Q,
      activity: { description: { contains: '50\\%\\_x', mode: 'insensitive' }, kind: 'TRANSPLANT' },
    });
  });

  it('«Sin clasificar» busca el tipo vacío', async () => {
    await listGardenHistoryEntries(PABLO, { kind: 'UNCLASSIFIED', all: true }, NOW);
    expect(whereOf()).toMatchObject({ activity: { kind: null } });
  });

  it('escapeLike', () => {
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});

describe('páginas', () => {
  it('20 por página, orden fecha → id descendente y cursor solo si hay más', async () => {
    const rows = Array.from({ length: 21 }, () => executionRow());
    db.kitchenGardenExecution.findMany.mockResolvedValue(rows);
    const first = await listGardenHistoryEntries(PABLO, {}, NOW);
    const call = db.kitchenGardenExecution.findMany.mock.calls[0]![0];
    expect(call).toMatchObject({
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(first.entries).toHaveLength(20);
    expect(decodeHistoryCursor(first.nextCursor!)).toEqual({
      completedAt: rows[19]!.completedAt,
      id: rows[19]!.id,
    });

    db.kitchenGardenExecution.findMany.mockClear();
    db.kitchenGardenExecution.findMany.mockResolvedValue([rows[20]]);
    const second = await listGardenHistoryEntries(PABLO, { cursor: first.nextCursor! }, NOW);
    expect(second.nextCursor).toBeNull();
    expect((whereOf().AND as unknown[])[1]).toEqual({
      OR: [
        { completedAt: { lt: rows[19]!.completedAt } },
        { completedAt: rows[19]!.completedAt, id: { lt: rows[19]!.id } },
      ],
    });
  });

  it('un cursor alterado → 400', async () => {
    await expect(
      listGardenHistoryEntries(PABLO, { cursor: Buffer.from('x|y').toString('base64url') }, NOW),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(encodeHistoryCursor(NOW, P)).not.toContain(P);
  });
});

describe('cada fila', () => {
  it('«Completada el…» (la única fecha guardada), día de negocio, quién la realizó y quién registró si es otra persona', async () => {
    db.kitchenGardenExecution.findMany.mockResolvedValue([
      executionRow({ completedAt: new Date('2026-11-02T01:30:00.000Z') }),
      executionRow({ recordedByUserId: 'u-admin', completedByParticipantId: Q }),
    ]);
    const { entries } = await listGardenHistoryEntries(PABLO, {}, NOW);
    expect(entries[0]).toMatchObject({
      completedAt: '2026-11-02T01:30:00.000Z',
      // 22:30 del domingo en Argentina.
      completedOn: '2026-11-01',
      completedBy: { displayName: 'Pablo sintético' },
      recordedBy: null,
    });
    expect(entries[1]).toMatchObject({
      completedBy: { displayName: 'Persona sintética Q' },
      assignedTo: { displayName: 'Pablo sintético' },
      recordedBy: { displayName: 'Admin sintética' },
    });
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('deshacer: lo propio del período vigente para el participante; cualquier vigente para el ADMIN; nunca una deshecha', async () => {
    db.kitchenGardenExecution.findMany.mockResolvedValue([
      executionRow(),
      executionRow({ completedByParticipantId: Q }),
      executionRow({
        periodKey: '2026-10-26',
        activity: {
          id: 'act-2',
          description: 'Regar sintético',
          kind: null,
          frequency: 'WEEKLY',
          active: true,
        },
      }),
      executionRow({
        revertedAt: NOW,
        revertedByUserId: 'u-admin',
        revertReason: 'Cargada dos veces',
      }),
    ]);
    const asPablo = (await listGardenHistoryEntries(PABLO, { includeReverted: true }, NOW)).entries;
    expect(asPablo.map((entry) => entry.canRevert)).toEqual([true, false, false, false]);
    expect(asPablo[3]!.reverted).toEqual({
      revertedAt: NOW.toISOString(),
      revertedBy: 'Admin sintética',
      reason: 'Cargada dos veces',
    });
    const asAdmin = (await listGardenHistoryEntries(ADMIN, { includeReverted: true }, NOW)).entries;
    expect(asAdmin.map((entry) => entry.canRevert)).toEqual([true, true, true, false]);
  });
});

describe('validación de la consulta', () => {
  it('texto de 2 a 100 caracteres (vacío = sin búsqueda), tipos válidos y banderas', () => {
    expect(gardenHistoryEntriesQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(gardenHistoryEntriesQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(gardenHistoryEntriesQuerySchema.parse({ q: '   ' })).toEqual({});
    expect(gardenHistoryEntriesQuerySchema.parse({ q: '  le  chu ' }).q).toBe('le chu');
    expect(
      gardenHistoryEntriesQuerySchema.parse({
        kind: 'SOWING',
        all: 'true',
        includeReverted: 'false',
      }),
    ).toEqual({ kind: 'SOWING', all: true, includeReverted: false });
    // «Cosecha» se retiró: tampoco es un filtro válido.
    expect(gardenHistoryEntriesQuerySchema.safeParse({ kind: 'HARVEST' }).success).toBe(false);
    expect(gardenHistoryEntriesQuerySchema.safeParse({ kind: 'CROP' }).success).toBe(false);
    expect(gardenHistoryEntriesQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});
