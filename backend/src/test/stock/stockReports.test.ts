import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/client';
import { ValidationError } from '../../errors/AppError';
import {
  STOCK_CSV_COLUMNS,
  STOCK_CSV_MAX_ROWS,
  STOCK_REPORT_RANKING_LIMIT,
  csvCell,
  csvDate,
  exportStockReportCsv,
  getStockReportSummary,
  listStockReportMovements,
  resolveReportRange,
} from '../../stock/stockReports';
import {
  STOCK_REPORT_MAX_DAYS,
  stockReportMovementsQuerySchema,
  stockReportSummaryQuerySchema,
} from '../../stock/stockSchemas';
import type { StockActor } from '../../stock/stockService';

/**
 * Reportes de Stock (Etapa 5C.2). `$queryRaw` se reemplaza por un espía que
 * registra cada `Prisma.Sql` recibido (texto + parámetros) y devuelve filas
 * sintéticas según la consulta. Así se prueba: cantidad de sentencias por
 * endpoint, que los valores del usuario viajen SOLO como parámetros, el
 * alcance por rol y el armado del DTO (sin mezclar unidades). La semántica
 * real del SQL la cubre `stockReports.integration.test.ts` contra `demo`.
 */

const queries: Prisma.Sql[] = [];
let respond: (sql: string) => unknown[] = () => [];

vi.mock('../../lib/prisma', () => ({
  prisma: {
    $queryRaw: vi.fn(async (query: Prisma.Sql) => {
      queries.push(query);
      return respond(query.sql);
    }),
  },
}));

const admin: StockActor = { userId: 'u-admin', role: 'ADMIN', employeeId: null };
const employee: StockActor = {
  userId: 'u-emp',
  role: 'EMPLOYEE',
  employeeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

// 2026-09-25 12:00 en Buenos Aires.
const NOW = new Date('2026-09-25T15:00:00.000Z');
const ITEM = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '11111111-1111-4111-8111-111111111111';
const DESTINATION = '88888888-8888-4888-8888-888888888888';

const baseFilters = { from: '2026-09-01', to: '2026-09-25' };

function kindOf(sql: string): string {
  if (sql.includes('WITH per_item')) return 'products';
  if (sql.includes('"consumption_destinations"') && sql.includes('GROUP BY d.')) {
    return 'destinations';
  }
  if (sql.includes('LEFT JOIN "employees"') && sql.includes('GROUP BY e.')) return 'employees';
  if (sql.includes('FROM "stock_items" i') && sql.includes('AS "level"')) return 'levels';
  if (sql.includes('GROUP BY m."type", i."unit"')) return 'totals';
  if (sql.includes('ORDER BY m."effective_date" ASC')) return 'csv';
  if (sql.includes('LIMIT') && sql.includes('OFFSET')) return 'movementsPage';
  if (sql.includes('AS "total"')) return 'movementsCount';
  return 'unknown';
}

beforeEach(() => {
  queries.length = 0;
  respond = () => [];
});

describe('resolveReportRange — fechas de BUSINESS_TIME_ZONE', () => {
  it('recorta `to` a hoy y marca includesCurrentDay', () => {
    const range = resolveReportRange('2026-09-01', '2026-12-31', NOW);
    expect(range.to).toEqual({ year: 2026, month: 9, day: 25 });
  });

  it('«hoy» es el día local, no el UTC (02:30 UTC del 26 = 23:30 del 25 en Argentina)', () => {
    const lateNight = new Date('2026-09-26T02:30:00.000Z');
    expect(() => resolveReportRange('2026-09-26', '2026-09-26', lateNight)).toThrow(
      'El período no puede empezar en el futuro.',
    );
    expect(resolveReportRange('2026-09-25', '2026-09-26', lateNight).to.day).toBe(25);
  });

  it('rechaza fechas inexistentes, orden invertido y rangos abusivos', () => {
    expect(() => resolveReportRange('2026-02-30', '2026-03-01', NOW)).toThrow(ValidationError);
    expect(() => resolveReportRange('2026-09-10', '2026-09-01', NOW)).toThrow(
      'La fecha «desde» no puede ser posterior a «hasta».',
    );
    expect(() => resolveReportRange('2025-01-01', '2026-09-25', NOW)).toThrow(
      `El período no puede superar ${STOCK_REPORT_MAX_DAYS} días.`,
    );
    // Exactamente el máximo es válido.
    expect(() => resolveReportRange('2025-09-25', '2026-09-25', NOW)).not.toThrow();
  });
});

describe('schemas de reportes — estrictos', () => {
  it('exigen from/to y rechazan parámetros desconocidos o ids inválidos', () => {
    expect(stockReportSummaryQuerySchema.safeParse({}).success).toBe(false);
    expect(stockReportSummaryQuerySchema.safeParse({ ...baseFilters }).success).toBe(true);
    expect(stockReportSummaryQuerySchema.safeParse({ ...baseFilters, orden: 'x' }).success).toBe(
      false,
    );
    expect(
      stockReportSummaryQuerySchema.safeParse({ ...baseFilters, itemId: "1' OR '1'='1" }).success,
    ).toBe(false);
    expect(stockReportSummaryQuerySchema.safeParse({ ...baseFilters, area: 'BOTH' }).success).toBe(
      false,
    );
  });

  it('movimientos: paginación con tope de 50 por página', () => {
    const parsed = stockReportMovementsQuerySchema.parse({ ...baseFilters });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
    expect(
      stockReportMovementsQuerySchema.safeParse({ ...baseFilters, pageSize: '51' }).success,
    ).toBe(false);
  });
});

describe('getStockReportSummary — consultas', () => {
  it('lanza 5 sentencias independientes (sin cascada) y todo valor viaja como parámetro', async () => {
    await getStockReportSummary(
      admin,
      {
        ...baseFilters,
        area: 'HOUSE',
        categoryId: CATEGORY,
        itemId: ITEM,
        employeeId: employee.employeeId!,
        destinationId: DESTINATION,
      },
      NOW,
    );
    expect(queries.map((query) => kindOf(query.sql)).sort()).toEqual(
      ['destinations', 'employees', 'levels', 'products', 'totals'].sort(),
    );
    for (const query of queries) {
      const text = query.sql;
      for (const value of [ITEM, CATEGORY, DESTINATION, employee.employeeId!, '2026-09-01']) {
        expect(text).not.toContain(value);
      }
    }
    const totals = queries.find((query) => kindOf(query.sql) === 'totals')!;
    expect(totals.values).toEqual(
      expect.arrayContaining([
        '2026-09-01',
        '2026-09-25',
        'HOUSE',
        CATEGORY,
        ITEM,
        employee.employeeId,
        DESTINATION,
      ]),
    );
  });

  it('con un tipo distinto de CONSUMPTION no consulta destinos (siempre estaría vacío)', async () => {
    const summary = await getStockReportSummary(admin, { ...baseFilters, type: 'INCOME' }, NOW);
    expect(queries).toHaveLength(4);
    expect(queries.some((query) => kindOf(query.sql) === 'destinations')).toBe(false);
    expect(summary.destinations).toEqual([]);
  });

  it('paridad con el prototipo: EMPLOYEE y ADMIN reciben exactamente el mismo reporte', async () => {
    await getStockReportSummary(employee, baseFilters, NOW);
    const employeeSql = queries.map((query) => [query.sql, query.values]);
    queries.length = 0;
    await getStockReportSummary(admin, baseFilters, NOW);
    expect(queries.map((query) => [query.sql, query.values])).toEqual(employeeSql);
    expect(queries.find((query) => kindOf(query.sql) === 'totals')!.sql).not.toContain(
      'i."active" = true',
    );
  });

  it('niveles actuales: solo activos y sin filtros de período/tipo/persona/destino', async () => {
    await getStockReportSummary(
      admin,
      { ...baseFilters, type: 'CONSUMPTION', employeeId: employee.employeeId!, area: 'GARDEN' },
      NOW,
    );
    const levels = queries.find((query) => kindOf(query.sql) === 'levels')!;
    expect(levels.sql).toContain('i."active" = true');
    expect(levels.sql).not.toContain('effective_date');
    expect(levels.values).toEqual(['GARDEN']);
  });
});

describe('getStockReportSummary — DTO sin mezclar unidades', () => {
  it('conteos globales por tipo; cantidades agrupadas por unidad, nunca sumadas entre sí', async () => {
    respond = (sql) => {
      if (kindOf(sql) === 'totals') {
        return [
          { type: 'CONSUMPTION', unit: 'kg', count: 2, quantity: '3.50' },
          { type: 'CONSUMPTION', unit: 'litros', count: 1, quantity: '2.00' },
          { type: 'INCOME', unit: 'kg', count: 1, quantity: '10.00' },
          { type: 'ADJUSTMENT_DECREASE', unit: 'kg', count: 1, quantity: '1.00' },
          { type: 'OPENING_BALANCE', unit: 'unidades', count: 4, quantity: '40.00' },
        ];
      }
      return [];
    };
    const summary = await getStockReportSummary(admin, baseFilters, NOW);
    expect(summary.totals).toEqual({
      movements: 9,
      income: { count: 1, byUnit: [{ unit: 'kg', quantity: '10' }] },
      consumption: {
        count: 3,
        byUnit: [
          { unit: 'kg', quantity: '3.5' },
          { unit: 'litros', quantity: '2' },
        ],
      },
      adjustments: { count: 1, increase: 0, decrease: 1 },
      openingBalance: { count: 4 },
    });
    expect(JSON.stringify(summary.totals)).not.toContain('5.5');
    expect(summary.range).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-25',
      includesCurrentDay: true,
      maxDays: STOCK_REPORT_MAX_DAYS,
    });
  });

  it('niveles por área, rankings, destinos (con "sin destino") y personas (con "sin persona")', async () => {
    respond = (sql) => {
      switch (kindOf(sql)) {
        case 'levels':
          return [
            { area: 'HOUSE', level: 'critical', count: 1 },
            { area: 'HOUSE', level: 'ok', count: 5 },
            { area: 'GARDEN', level: 'low', count: 2 },
          ];
        case 'products':
          return [
            {
              id: ITEM,
              name: 'Producto sintético A',
              area: 'HOUSE',
              unit: 'kg',
              active: true,
              movementCount: 4,
              consumptionCount: 0,
              consumed: '0',
              income: '12.00',
              countRank: 1,
              consumptionRank: 2,
              productsWithMovements: 2,
            },
            {
              id: 'p2',
              name: 'Producto sintético B',
              area: 'GARDEN',
              unit: 'litros',
              active: false,
              movementCount: 2,
              consumptionCount: 2,
              consumed: '1.50',
              income: '0',
              countRank: 2,
              consumptionRank: 1,
              productsWithMovements: 2,
            },
          ];
        case 'destinations':
          return [
            {
              id: null,
              name: null,
              type: null,
              active: null,
              unit: 'kg',
              count: 3,
              quantity: '3.00',
            },
            {
              id: DESTINATION,
              name: 'Destino sintético',
              type: 'VEHICLE',
              active: true,
              unit: 'kg',
              count: 2,
              quantity: '1.00',
            },
            {
              id: DESTINATION,
              name: 'Destino sintético',
              type: 'VEHICLE',
              active: true,
              unit: 'litros',
              count: 1,
              quantity: '0.50',
            },
          ];
        case 'employees':
          return [
            { id: null, displayName: null, colorHex: null, type: 'OPENING_BALANCE', count: 3 },
            {
              id: 'e1',
              displayName: 'Persona sintética',
              colorHex: '#4a7c59',
              type: 'INCOME',
              count: 2,
            },
            {
              id: 'e1',
              displayName: 'Persona sintética',
              colorHex: '#4a7c59',
              type: 'CONSUMPTION',
              count: 1,
            },
          ];
        default:
          return [];
      }
    };
    const summary = await getStockReportSummary(admin, baseFilters, NOW);

    expect(summary.currentLevels).toEqual({
      critical: 1,
      low: 2,
      ok: 5,
      byArea: [
        { area: 'HOUSE', critical: 1, low: 0, ok: 5 },
        { area: 'GARDEN', critical: 0, low: 2, ok: 0 },
      ],
    });
    expect(summary.products.withMovements).toBe(2);
    expect(summary.products.mostMoved.map((row) => row.item.name)).toEqual([
      'Producto sintético A',
      'Producto sintético B',
    ]);
    // Solo productos con consumos entran al ranking (ordenado por cantidad de consumos).
    expect(summary.products.mostConsumed).toEqual([
      expect.objectContaining({
        consumed: '1.5',
        item: expect.objectContaining({ unit: 'litros' }),
      }),
    ]);
    // Un grupo por destino, con sus unidades separadas; "sin destino" = null.
    expect(summary.destinations).toEqual([
      {
        destination: { id: DESTINATION, name: 'Destino sintético', type: 'VEHICLE', active: true },
        count: 3,
        byUnit: [
          { unit: 'kg', quantity: '1' },
          { unit: 'litros', quantity: '0.5' },
        ],
      },
      { destination: null, count: 3, byUnit: [{ unit: 'kg', quantity: '3' }] },
    ]);
    expect(summary.employees[0]).toMatchObject({
      employee: { id: 'e1', displayName: 'Persona sintética' },
      total: 3,
      byType: { INCOME: 2, CONSUMPTION: 1, OPENING_BALANCE: 0 },
    });
    expect(summary.employees[1]).toMatchObject({ employee: null, total: 3 });
  });

  it('el ranking pide como máximo el límite configurado', async () => {
    await getStockReportSummary(admin, baseFilters, NOW);
    const products = queries.find((query) => kindOf(query.sql) === 'products')!;
    expect(products.values).toContain(STOCK_REPORT_RANKING_LIMIT);
  });

  it('sin movimientos: estado vacío real (ceros, listas vacías), sin inventar datos', async () => {
    const summary = await getStockReportSummary(employee, baseFilters, NOW);
    expect(summary.totals.movements).toBe(0);
    expect(summary.totals.income.byUnit).toEqual([]);
    expect(summary.products).toEqual({ withMovements: 0, mostMoved: [], mostConsumed: [] });
    expect(summary.destinations).toEqual([]);
    expect(summary.employees).toEqual([]);
  });
});

describe('listStockReportMovements — paginación en Postgres, sin N+1', () => {
  it('2 sentencias (página con JOIN + total), LIMIT/OFFSET como parámetros', async () => {
    respond = (sql) => {
      if (kindOf(sql) === 'movementsCount') return [{ total: 45 }];
      if (kindOf(sql) === 'movementsPage') {
        return [
          {
            id: 'm1',
            type: 'CONSUMPTION',
            quantity: '2.50',
            effectiveDate: new Date('2026-09-24T00:00:00.000Z'),
            reason: null,
            createdAt: new Date('2026-09-24T13:00:00.000Z'),
            itemId: ITEM,
            itemName: 'Producto sintético A',
            itemArea: 'HOUSE',
            itemUnit: 'kg',
            itemActive: true,
            employeeId: null,
            employeeName: null,
            employeeColor: null,
            destinationId: DESTINATION,
            destinationName: 'Destino sintético',
            destinationType: 'SECTOR',
          },
        ];
      }
      return [];
    };
    const result = await listStockReportMovements(
      admin,
      { ...baseFilters, page: 3, pageSize: 20 },
      NOW,
    );
    expect(queries).toHaveLength(2);
    const page = queries.find((query) => kindOf(query.sql) === 'movementsPage')!;
    expect(page.sql).toContain('LEFT JOIN "employees"');
    expect(page.sql).toContain('LEFT JOIN "consumption_destinations"');
    expect(page.values.slice(-2)).toEqual([20, 40]);
    expect(result).toMatchObject({ page: 3, pageSize: 20, total: 45, totalPages: 3 });
    expect(result.movements).toEqual([
      {
        id: 'm1',
        type: 'CONSUMPTION',
        quantity: '2.5',
        effectiveDate: '2026-09-24',
        reason: null,
        createdAt: '2026-09-24T13:00:00.000Z',
        item: { id: ITEM, name: 'Producto sintético A', area: 'HOUSE', unit: 'kg', active: true },
        employee: null,
        recordedBy: null,
        destination: { id: DESTINATION, name: 'Destino sintético', type: 'SECTOR' },
      },
    ]);
  });

  it('un rango inválido falla antes de consultar la base', async () => {
    await expect(
      listStockReportMovements(
        admin,
        { from: '2026-10-01', to: '2026-10-02', page: 1, pageSize: 20 },
        NOW,
      ),
    ).rejects.toThrow('El período no puede empezar en el futuro.');
    expect(queries).toHaveLength(0);
  });
});

describe('reportes — autor de los movimientos sin persona asociada', () => {
  const ADMIN_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const ADMIN_B = 'bbbbbbbb-0000-4000-8000-00000000000b';

  it('el autor sale de la auditoría de ALTA y solo para filas sin persona (parámetros, sin N+1)', async () => {
    await listStockReportMovements(admin, { ...baseFilters, page: 1, pageSize: 20 }, NOW);
    const page = queries.find((query) => kindOf(query.sql) === 'movementsPage')!;
    expect(queries).toHaveLength(2);
    expect(page.sql).toContain('LEFT JOIN LATERAL');
    expect(page.sql).toContain('m."employee_id" IS NULL');
    expect(page.sql).toContain('HAVING COUNT(*) = 1');
    expect(page.values).toEqual(
      expect.arrayContaining(['StockMovement', 'stock.movement.created', 'Administrador']),
    );
    // Nunca el username ni ninguna edición/anulación posterior.
    expect(page.sql).not.toContain('username');
  });

  it('personas: un grupo por administrador que registró; las aperturas sin autor quedan aparte', async () => {
    respond = (sql) =>
      kindOf(sql) === 'employees'
        ? [
            {
              id: null,
              displayName: null,
              colorHex: null,
              creatorId: null,
              creatorName: null,
              type: 'OPENING_BALANCE',
              count: 4,
            },
            {
              id: null,
              displayName: null,
              colorHex: null,
              creatorId: ADMIN_A,
              creatorName: 'Admin sintética Uno',
              type: 'INCOME',
              count: 2,
            },
            {
              id: null,
              displayName: null,
              colorHex: null,
              creatorId: ADMIN_B,
              creatorName: 'Admin sintético Dos',
              type: 'CONSUMPTION',
              count: 1,
            },
            {
              id: null,
              displayName: null,
              colorHex: null,
              creatorId: ADMIN_B,
              creatorName: 'Admin sintético Dos',
              type: 'INCOME',
              count: 1,
            },
            {
              id: 'e1',
              displayName: 'Persona sintética',
              colorHex: '#4a7c59',
              creatorId: null,
              creatorName: null,
              type: 'CONSUMPTION',
              count: 2,
            },
          ]
        : [];
    const summary = await getStockReportSummary(admin, baseFilters, NOW);
    expect(summary.employees).toEqual([
      {
        employee: null,
        recordedBy: null,
        total: 4,
        byType: expect.objectContaining({ OPENING_BALANCE: 4 }),
      },
      {
        employee: null,
        recordedBy: { displayName: 'Admin sintética Uno' },
        total: 2,
        byType: expect.objectContaining({ INCOME: 2 }),
      },
      {
        employee: null,
        recordedBy: { displayName: 'Admin sintético Dos' },
        total: 2,
        byType: expect.objectContaining({ INCOME: 1, CONSUMPTION: 1 }),
      },
      {
        employee: { id: 'e1', displayName: 'Persona sintética', colorHex: '#4a7c59' },
        recordedBy: null,
        total: 2,
        byType: expect.objectContaining({ CONSUMPTION: 2 }),
      },
    ]);
    // Ningún dato de cuenta (id de usuario, username) sale en el DTO.
    expect(JSON.stringify(summary.employees)).not.toContain(ADMIN_A);
  });

  it('listado: la persona asociada se conserva; sin ella, el autor; sin evidencia, null', async () => {
    const base = {
      type: 'INCOME',
      quantity: '1.00',
      effectiveDate: new Date('2026-09-24T00:00:00.000Z'),
      reason: null,
      createdAt: new Date('2026-09-24T13:00:00.000Z'),
      itemId: ITEM,
      itemName: 'Producto sintético A',
      itemArea: 'GARDEN',
      itemUnit: 'kg',
      itemActive: true,
      employeeId: null,
      employeeName: null,
      employeeColor: null,
      creatorName: null,
      destinationId: null,
      destinationName: null,
      destinationType: null,
    };
    respond = (sql) =>
      kindOf(sql) === 'movementsPage'
        ? [
            { ...base, id: 'm1', creatorName: 'Admin sintética Uno' },
            { ...base, id: 'm2', creatorName: 'Admin sintético Dos' },
            { ...base, id: 'm3', employeeId: 'e1', employeeName: 'Persona sintética' },
            { ...base, id: 'm4', type: 'OPENING_BALANCE' },
          ]
        : [{ total: 4 }];
    const { movements } = await listStockReportMovements(
      admin,
      { ...baseFilters, page: 1, pageSize: 20 },
      NOW,
    );
    expect(movements.map((row) => [row.employee?.displayName ?? null, row.recordedBy])).toEqual([
      [null, { displayName: 'Admin sintética Uno' }],
      [null, { displayName: 'Admin sintético Dos' }],
      ['Persona sintética', null],
      [null, null],
    ]);
  });

  it('CSV: «Persona» es la persona asociada o, sin ella, quien registró; las aperturas quedan vacías', async () => {
    const row = (overrides: Record<string, unknown>) => ({
      type: 'INCOME',
      quantity: '3.00',
      effectiveDate: new Date('2026-09-20T00:00:00.000Z'),
      reason: null,
      itemName: 'Producto sintético',
      itemUnit: 'kg',
      employeeId: null,
      employeeName: null,
      creatorName: null,
      destinationName: null,
      ...overrides,
    });
    respond = () => [
      row({ creatorName: 'Admin sintética Uno' }),
      row({ creatorName: 'Admin sintético Dos' }),
      row({ employeeId: 'e1', employeeName: 'Persona sintética' }),
      row({ type: 'OPENING_BALANCE' }),
    ];
    const { content } = await exportStockReportCsv(admin, baseFilters, NOW);
    const persons = content
      .slice(1)
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[4]);
    expect(persons).toEqual([
      '"Admin sintética Uno"',
      '"Admin sintético Dos"',
      '"Persona sintética"',
      '""',
    ]);
    expect(queries[0]!.sql).toContain('LEFT JOIN LATERAL');
  });
});

describe('exportStockReportCsv — paridad con exportarCSV() del prototipo', () => {
  const row = (overrides: Record<string, unknown>) => ({
    type: 'CONSUMPTION',
    quantity: '2.50',
    effectiveDate: new Date('2026-09-20T00:00:00.000Z'),
    reason: null,
    itemName: 'Producto sintético',
    itemUnit: 'kg',
    employeeId: 'e1',
    employeeName: 'Persona sintética',
    destinationName: null,
    ...overrides,
  });

  it('columnas originales, orden cronológico, una sola sentencia y valores parametrizados', async () => {
    respond = (sql) =>
      kindOf(sql) === 'csv'
        ? [
            row({ destinationName: 'Destino sintético', reason: 'Uso "diario"' }),
            row({
              type: 'INCOME',
              quantity: '10.00',
              reason: 'Compra',
              employeeId: null,
              employeeName: null,
            }),
            row({ type: 'ADJUSTMENT_DECREASE', quantity: '1.00', reason: 'Conteo' }),
            row({
              type: 'OPENING_BALANCE',
              quantity: '3.00',
              employeeId: null,
              employeeName: null,
            }),
          ]
        : [];
    const { filename, content } = await exportStockReportCsv(
      employee,
      { ...baseFilters, itemId: ITEM },
      NOW,
    );
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('ORDER BY m."effective_date" ASC');
    expect(queries[0]!.sql).not.toContain(ITEM);
    expect(queries[0]!.values).toContain(ITEM);
    expect(filename).toBe('consumos_lacañada.csv');
    expect(content.startsWith('﻿')).toBe(true);
    const lines = content.slice(1).split('\n');
    expect(lines[0]).toBe(STOCK_CSV_COLUMNS.map((column) => `"${column}"`).join(','));
    expect(lines[0]).toBe('"Fecha","Ítem","Cantidad","Unidad","Persona","Destino","Motivo"');
    expect(lines[1]).toBe(
      [
        '20/09/2026',
        'Producto sintético',
        '2.5',
        'kg',
        'Persona sintética',
        'Destino sintético',
        'Uso ""diario""',
      ]
        .map((value) => `"${value}"`)
        .join(','),
    );
    // Prefijos derivados del tipo, como los escribía el prototipo.
    expect(lines[2]).toBe(
      ['20/09/2026', 'Producto sintético', '10', 'kg', '', '', '[Admin] [Ingreso] Compra']
        .map((value) => `"${value}"`)
        .join(','),
    );
    expect(lines[3]).toContain('"Ajuste a la baja: -1 kg · Conteo"');
    expect(lines[4]).toContain('"Saldo inicial"');
  });

  it('neutraliza fórmulas de planilla y rechaza exportaciones gigantes sin truncar', async () => {
    expect(csvDate(new Date('2026-01-05T00:00:00.000Z'))).toBe('05/01/2026');
    expect(csvDate(new Date('2028-02-29T00:00:00.000Z'))).toBe('29/02/2028');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM')).toBe(`"'@SUM"`);
    expect(csvCell('  =SUM(A1:A2)')).toBe(`"'  =SUM(A1:A2)"`);
    expect(csvCell('Normal')).toBe('"Normal"');
    respond = () => Array.from({ length: STOCK_CSV_MAX_ROWS + 1 }, () => row({}));
    await expect(exportStockReportCsv(admin, baseFilters, NOW)).rejects.toThrow(/Acotá el período/);
  });

  it('escapa comas, comillas y saltos; sin datos devuelve solo cabeceras', async () => {
    expect(csvCell('uno,dos')).toBe('"uno,dos"');
    expect(csvCell('línea 1\nlínea "2"')).toBe('"línea 1\nlínea ""2"""');
    respond = () => [];
    const { content } = await exportStockReportCsv(employee, baseFilters, NOW);
    expect(content.slice(1)).toBe(
      '"Fecha","Ítem","Cantidad","Unidad","Persona","Destino","Motivo"',
    );
  });

  it('valida el rango igual que el reporte, antes de consultar', async () => {
    await expect(
      exportStockReportCsv(admin, { from: '2026-10-01', to: '2026-10-02' }, NOW),
    ).rejects.toThrow('El período no puede empezar en el futuro.');
    expect(queries).toHaveLength(0);
  });
});
