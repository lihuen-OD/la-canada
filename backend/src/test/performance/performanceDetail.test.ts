import { describe, expect, it } from 'vitest';
import {
  compareDetail,
  decodeCursor,
  detailPlacement,
  detailStatusOf,
  encodeCursor,
  matchesFilters,
  pageOf,
  type DetailSortKey,
} from '../../performance/performanceDetail';
import {
  performanceDetailQuerySchema,
  performanceRangeSchema,
} from '../../performance/performanceSchemas';

const P = 'persona';
const key = (groupDate: string | null, description: string, taskId: string, periodKey = 'k') => ({
  groupDate,
  description,
  taskId,
  periodKey,
});

describe('detailPlacement — día que agrupa y período completo', () => {
  it.each([
    ['DAILY', '2026-10-29', undefined, '2026-10-29', { start: '2026-10-29', end: '2026-10-29' }],
    ['WEEKLY', '2026-10-26', undefined, '2026-10-26', { start: '2026-10-26', end: '2026-11-01' }],
    [
      'SEMI_MONTHLY',
      '2026-10-Q2',
      undefined,
      '2026-10-16',
      { start: '2026-10-16', end: '2026-10-31' },
    ],
    ['MONTHLY', '2026-10-01', undefined, '2026-10-01', { start: '2026-10-01', end: '2026-10-31' }],
    ['BIMONTHLY', '2026-B6', undefined, '2026-11-01', { start: '2026-11-01', end: '2026-12-31' }],
    ['ANNUAL', '2027-A', undefined, '2027-01-01', { start: '2027-01-01', end: '2027-12-31' }],
    ['ONE_TIME', 'ONE_TIME', '2026-10-27', '2026-10-27', null],
    ['ONE_TIME', 'ONE_TIME', undefined, null, null],
    ['URGENT', 'URGENT', undefined, null, null],
  ] as const)('%s %s (%s)', (frequency, periodKey, scheduledDate, groupDate, period) => {
    expect(detailPlacement({ frequency, periodKey, scheduledDate })).toEqual({ groupDate, period });
  });
});

describe('compareDetail — más recientes primero, sin fecha al final, desempate estable', () => {
  it('hoy, ayer, anteriores; con la misma fecha por descripción, tarea y período; sin fecha al final', () => {
    const rows = [
      key(null, 'Urgente', 'u'),
      key('2026-10-28', 'Barrer', 'b'),
      key('2026-10-30', 'Regar', 'r'),
      key('2026-10-29', 'Aspirar', 'a2'),
      key('2026-10-29', 'Aspirar', 'a1'),
      key(null, 'Ordenar', 'o'),
      key('2026-10-29', 'aspirar', 'a0'),
      key('2026-10-30', 'Aspirar', 'z'),
    ];
    expect(
      rows.sort(compareDetail).map((r) => `${r.groupDate ?? '—'} ${r.description} ${r.taskId}`),
    ).toEqual([
      '2026-10-30 Aspirar z',
      '2026-10-30 Regar r',
      '2026-10-29 aspirar a0',
      '2026-10-29 Aspirar a1',
      '2026-10-29 Aspirar a2',
      '2026-10-28 Barrer b',
      '— Ordenar o',
      '— Urgente u',
    ]);
  });

  it('es un orden total: dos obligaciones distintas nunca empatan', () => {
    const a = key('2026-10-29', 'Aspirar', 't', '2026-10-29');
    expect(compareDetail(a, { ...a })).toBe(0);
    expect(compareDetail(a, { ...a, periodKey: '2026-10-30' })).not.toBe(0);
    expect(compareDetail(a, { ...a, taskId: 'u' })).not.toBe(0);
  });
});

describe('filtros', () => {
  const placed = (
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONE_TIME' | 'URGENT',
    periodKey: string,
    scheduledDate?: string,
  ) => ({
    frequency,
    status: 'pending' as const,
    ...detailPlacement({ frequency, periodKey, scheduledDate }),
  });

  it('un día incluye las recurrentes cuyo período lo contiene; las sin fecha nunca coinciden', () => {
    const date = '2026-10-28';
    expect(matchesFilters(placed('DAILY', '2026-10-28'), { date })).toBe(true);
    expect(matchesFilters(placed('DAILY', '2026-10-27'), { date })).toBe(false);
    expect(matchesFilters(placed('WEEKLY', '2026-10-26'), { date })).toBe(true);
    expect(matchesFilters(placed('WEEKLY', '2026-10-19'), { date })).toBe(false);
    expect(matchesFilters(placed('MONTHLY', '2026-10-01'), { date })).toBe(true);
    expect(matchesFilters(placed('ONE_TIME', 'ONE_TIME', '2026-10-28'), { date })).toBe(true);
    expect(matchesFilters(placed('ONE_TIME', 'ONE_TIME'), { date })).toBe(false);
    expect(matchesFilters(placed('URGENT', 'URGENT'), { date })).toBe(false);
  });

  it('frecuencia y estado, solos y combinados', () => {
    const row = placed('WEEKLY', '2026-10-26');
    expect(matchesFilters(row, { frequency: 'WEEKLY' })).toBe(true);
    expect(matchesFilters(row, { frequency: 'DAILY' })).toBe(false);
    expect(
      matchesFilters(row, { status: 'pending', frequency: 'WEEKLY', date: '2026-11-01' }),
    ).toBe(true);
    expect(matchesFilters(row, { status: 'personal', frequency: 'WEEKLY' })).toBe(false);
  });

  it('estado desde la persona: propia realizada, cubierta, pendiente o «Cubrió a otros»', () => {
    const own = { assignedEmployeeId: P };
    expect(detailStatusOf({ ...own, completed: false, completedByEmployeeId: null }, P)).toBe(
      'pending',
    );
    expect(detailStatusOf({ ...own, completed: true, completedByEmployeeId: P }, P)).toBe(
      'personal',
    );
    expect(detailStatusOf({ ...own, completed: true, completedByEmployeeId: 'otra' }, P)).toBe(
      'covered',
    );
    expect(
      detailStatusOf({ assignedEmployeeId: 'otra', completed: true, completedByEmployeeId: P }, P),
    ).toBe('coverageGiven');
  });
});

describe('pageOf — páginas por cursor, sin duplicados ni omisiones', () => {
  // 45 obligaciones en 9 días (5 por día) + 2 sin fecha: los grupos atraviesan páginas.
  const rows: DetailSortKey[] = [
    ...Array.from({ length: 45 }, (_, i) =>
      key(`2026-10-${String(30 - Math.floor(i / 5)).padStart(2, '0')}`, `Tarea ${i % 5}`, `t${i}`),
    ),
    key(null, 'Urgente', 'u1', 'URGENT'),
    key(null, 'Una vez sin fecha', 'o1', 'ONE_TIME'),
  ];
  const all = (limit: number) => {
    const seen: DetailSortKey[] = [];
    let cursor: DetailSortKey | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = pageOf(rows, cursor, limit);
      expect(page.total).toBe(47);
      seen.push(...page.items);
      if (!page.nextCursor) break;
      cursor = decodeCursor(page.nextCursor);
    }
    return seen;
  };

  it('3 páginas de 20: 20 + 20 + 7, todas distintas, en el orden total y sin fecha al final', () => {
    const first = pageOf(rows, null, 20);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]!.groupDate).toBe('2026-10-30');
    const seen = all(20);
    expect(seen).toHaveLength(47);
    expect(new Set(seen.map((r) => r.taskId)).size).toBe(47);
    expect(seen).toEqual([...rows].sort(compareDetail));
    expect(seen.slice(-2).map((r) => r.groupDate)).toEqual([null, null]);
  });

  it('un grupo de fecha que atraviesa dos páginas sigue en orden (la página 2 empieza donde terminó la 1)', () => {
    const first = pageOf(rows, null, 7); // 5 del 30 + 2 del 29
    const second = pageOf(rows, decodeCursor(first.nextCursor!), 7);
    expect(first.items.at(-1)!.groupDate).toBe('2026-10-29');
    expect(second.items[0]!.groupDate).toBe('2026-10-29');
    expect(compareDetail(first.items.at(-1)!, second.items[0]!)).toBeLessThan(0);
  });

  it('si la última obligación entregada desaparece (p. ej. se marcó), la siguiente página no saltea ni repite', () => {
    const first = pageOf(rows, null, 20);
    const cursor = decodeCursor(first.nextCursor!)!;
    const withoutLast = rows.filter((r) => r.taskId !== first.items.at(-1)!.taskId);
    const second = pageOf(withoutLast, cursor, 20);
    expect(second.items[0]).toEqual([...rows].sort(compareDetail)[20]);
  });

  it('última página sin cursor; cursor al final → página vacía', () => {
    expect(pageOf(rows, null, 50).nextCursor).toBeNull();
    expect(pageOf(rows, key(null, 'zzz', 'zzz', 'zzz'), 20).items).toEqual([]);
  });

  it('cursor: ida y vuelta, y uno inválido se rechaza', () => {
    const sample = key('2026-10-29', 'Aspirar «planta» baja', 't1', '2026-10-29');
    expect(decodeCursor(encodeCursor(sample))).toEqual(sample);
    expect(encodeCursor(sample)).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const bad of ['', 'no-es-json', Buffer.from('[1,2,3]').toString('base64url')]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });
});

describe('esquemas: solo el detalle acepta filtros y página', () => {
  const range = { from: '2026-10-24', to: '2026-10-30' };
  it('acepta filtros y página válidos', () => {
    expect(
      performanceDetailQuerySchema.parse({
        ...range,
        date: '2026-10-28',
        frequency: 'WEEKLY',
        status: 'coverageGiven',
        limit: '20',
        cursor: 'abc_-1',
      }),
    ).toMatchObject({ limit: 20, status: 'coverageGiven' });
    expect(performanceDetailQuerySchema.parse(range)).toEqual(range);
  });

  it.each([
    ['fecha inexistente', { date: '2026-02-30' }],
    ['frecuencia', { frequency: 'HOURLY' }],
    ['estado', { status: 'done' }],
    ['límite 0', { limit: '0' }],
    ['límite 51', { limit: '51' }],
    ['límite no numérico', { limit: 'diez' }],
    ['cursor con caracteres raros', { cursor: 'a b' }],
    ['campo desconocido', { page: '2' }],
  ])('rechaza %s', (_label, extra) => {
    expect(performanceDetailQuerySchema.safeParse({ ...range, ...extra }).success).toBe(false);
  });

  it('el resumen sigue sin aceptar filtros', () => {
    expect(performanceRangeSchema.safeParse({ ...range, status: 'pending' }).success).toBe(false);
  });
});
