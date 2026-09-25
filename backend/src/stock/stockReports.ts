import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { ValidationError } from '../errors/AppError';
import {
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { prisma } from '../lib/prisma';
import { STOCK_LEVEL_CASE_SQL, type StockLevel } from './stockLevel';
import { STOCK_REPORT_MAX_DAYS } from './stockSchemas';
import type { StockActor } from './stockService';

/**
 * Reportes de Stock (Etapa 5C.2) — agregaciones SIEMPRE en PostgreSQL, nunca
 * sobre el historial descargado. Todo valor del usuario viaja como parámetro
 * de `Prisma.sql` (sin `Prisma.raw` ni interpolación de texto); los casts a
 * los enums de Postgres son texto fijo.
 *
 * Permisos — paridad con el prototipo (docs/BUSINESS_RULES.md §8, verificado
 * contra el `index.html` original): la pestaña Reportes y "📥 Exportar" no
 * eran `admin-only`, así que TODO usuario autenticado ve exactamente el
 * mismo reporte y puede exportarlo. No hay recorte por rol.
 *
 * Cantidades: nunca se suman unidades distintas. Cada total de cantidad se
 * agrupa por `unit` del producto (texto libre del catálogo: "kg" y "litros"
 * son grupos separados); los conteos de movimientos sí son globales.
 */

type MovementTypeName =
  'OPENING_BALANCE' | 'INCOME' | 'CONSUMPTION' | 'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE';

export interface StockReportFilters {
  from: string;
  to: string;
  area?: 'HOUSE' | 'GARDEN';
  categoryId?: string;
  type?: MovementTypeName;
  itemId?: string;
  employeeId?: string;
  destinationId?: string;
}

/** Tope de filas de los rankings de productos (más movidos / más consumidos). */
export const STOCK_REPORT_RANKING_LIMIT = 10;
/** Tope defensivo de filas agrupadas por destino × unidad. */
const DESTINATION_ROWS_LIMIT = 500;

const MOVEMENT_TYPES: readonly MovementTypeName[] = [
  'OPENING_BALANCE',
  'INCOME',
  'CONSUMPTION',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
];

interface ResolvedRange {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
}

function daysBetween(from: LocalDate, to: LocalDate): number {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Período del reporte en fechas de calendario de `BUSINESS_TIME_ZONE`
 * (misma semántica que `StockMovement.effectiveDate`): `from <= to`, sin
 * empezar en el futuro, `to` recortado a hoy y como máximo
 * `STOCK_REPORT_MAX_DAYS` días.
 */
export function resolveReportRange(fromText: string, toText: string, now: Date): ResolvedRange {
  const from = parseLocalDate(fromText);
  const requestedTo = parseLocalDate(toText);
  if (!from || !requestedTo) throw new ValidationError('Las fechas del reporte no son válidas.');
  if (compareLocalDates(from, requestedTo) > 0) {
    throw new ValidationError('La fecha «desde» no puede ser posterior a «hasta».');
  }
  const today = toLocalDate(now, config.businessTimeZone);
  if (compareLocalDates(from, today) > 0) {
    throw new ValidationError('El período no puede empezar en el futuro.');
  }
  const to = compareLocalDates(requestedTo, today) > 0 ? today : requestedTo;
  if (daysBetween(from, to) > STOCK_REPORT_MAX_DAYS) {
    throw new ValidationError(`El período no puede superar ${STOCK_REPORT_MAX_DAYS} días.`);
  }
  return { from, to, today };
}

function rangeDto(range: ResolvedRange) {
  return {
    from: formatLocalDate(range.from),
    to: formatLocalDate(range.to),
    timeZone: config.businessTimeZone,
    includesCurrentDay: compareLocalDates(range.to, range.today) === 0,
    maxDays: STOCK_REPORT_MAX_DAYS,
  };
}

/**
 * WHERE compartido de las consultas sobre movimientos (`m` = stock_movements
 * JOIN `i` = stock_items). Cada condición es un fragmento con parámetros.
 */
function movementWhere(filters: StockReportFilters, range: ResolvedRange): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`m."effective_date" >= ${formatLocalDate(range.from)}::date`,
    Prisma.sql`m."effective_date" <= ${formatLocalDate(range.to)}::date`,
  ];
  if (filters.area) conditions.push(Prisma.sql`i."area" = ${filters.area}::"StockArea"`);
  if (filters.categoryId) {
    conditions.push(Prisma.sql`i."category_id" = ${filters.categoryId}::uuid`);
  }
  if (filters.type) conditions.push(Prisma.sql`m."type" = ${filters.type}::"StockMovementType"`);
  if (filters.itemId) conditions.push(Prisma.sql`m."stock_item_id" = ${filters.itemId}::uuid`);
  if (filters.employeeId) {
    conditions.push(Prisma.sql`m."employee_id" = ${filters.employeeId}::uuid`);
  }
  if (filters.destinationId) {
    conditions.push(Prisma.sql`m."destination_id" = ${filters.destinationId}::uuid`);
  }
  return Prisma.join(conditions, ' AND ');
}

/** Decimal de Postgres → string canónico, igual que el resto de los DTO de Stock. */
function decimalText(value: string | null): string {
  return new Prisma.Decimal(value ?? '0').toString();
}

// ── Filas crudas (alias explícitos en cada SELECT) ───────────────────────

interface TotalsRow {
  type: MovementTypeName;
  unit: string;
  count: number;
  quantity: string | null;
}

interface LevelRow {
  area: 'HOUSE' | 'GARDEN';
  level: StockLevel;
  count: number;
}

interface ProductRow {
  id: string;
  name: string;
  area: 'HOUSE' | 'GARDEN';
  unit: string;
  active: boolean;
  movementCount: number;
  consumptionCount: number;
  consumed: string | null;
  income: string | null;
  countRank: number;
  consumptionRank: number;
  productsWithMovements: number;
}

interface DestinationRow {
  id: string | null;
  name: string | null;
  type: 'VEHICLE' | 'SECTOR' | null;
  active: boolean | null;
  unit: string;
  count: number;
  quantity: string | null;
}

interface EmployeeRow {
  id: string | null;
  displayName: string | null;
  colorHex: string | null;
  type: MovementTypeName;
  count: number;
}

interface MovementRow {
  id: string;
  type: MovementTypeName;
  quantity: string;
  effectiveDate: Date;
  reason: string | null;
  createdAt: Date;
  itemId: string;
  itemName: string;
  itemArea: 'HOUSE' | 'GARDEN';
  itemUnit: string;
  itemActive: boolean;
  employeeId: string | null;
  employeeName: string | null;
  employeeColor: string | null;
  destinationId: string | null;
  destinationName: string | null;
  destinationType: 'VEHICLE' | 'SECTOR' | null;
}

const FROM_MOVEMENTS = Prisma.sql`FROM "stock_movements" m
  JOIN "stock_items" i ON i."id" = m."stock_item_id"`;

type QuantityByUnit = { unit: string; quantity: string };

function emptyByType(): Record<MovementTypeName, number> {
  return Object.fromEntries(MOVEMENT_TYPES.map((type) => [type, 0])) as Record<
    MovementTypeName,
    number
  >;
}

function unitTotals(rows: TotalsRow[], type: MovementTypeName): QuantityByUnit[] {
  return rows
    .filter((row) => row.type === type)
    .map((row) => ({ unit: row.unit, quantity: decimalText(row.quantity) }))
    .sort((a, b) => a.unit.localeCompare(b.unit, 'es'));
}

/**
 * `GET /stock/reports/summary`: resumen, niveles actuales, rankings de
 * productos, consumos por destino y movimientos por persona. Cinco
 * sentencias SQL independientes lanzadas en paralelo (sin cascada): una
 * ida y vuelta a Postgres. Con un filtro de tipo distinto de `CONSUMPTION`
 * la consulta de destinos no se ejecuta (siempre estaría vacía).
 */
export async function getStockReportSummary(
  _actor: StockActor,
  filters: StockReportFilters,
  now = new Date(),
) {
  const range = resolveReportRange(filters.from, filters.to, now);
  const where = movementWhere(filters, range);

  const levelConditions: Prisma.Sql[] = [Prisma.sql`i."active" = true`];
  if (filters.area) levelConditions.push(Prisma.sql`i."area" = ${filters.area}::"StockArea"`);
  if (filters.categoryId) {
    levelConditions.push(Prisma.sql`i."category_id" = ${filters.categoryId}::uuid`);
  }
  if (filters.itemId) levelConditions.push(Prisma.sql`i."id" = ${filters.itemId}::uuid`);

  const skipDestinations = filters.type !== undefined && filters.type !== 'CONSUMPTION';

  const [totalsRows, levelRows, productRows, destinationRows, employeeRows] = await Promise.all([
    prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
      SELECT m."type"::text AS "type", i."unit" AS "unit",
        COUNT(*)::int AS "count", SUM(m."quantity")::text AS "quantity"
      ${FROM_MOVEMENTS}
      WHERE ${where}
      GROUP BY m."type", i."unit"
      ORDER BY m."type", i."unit"`),
    prisma.$queryRaw<LevelRow[]>(Prisma.sql`
      SELECT i."area"::text AS "area", ${STOCK_LEVEL_CASE_SQL} AS "level", COUNT(*)::int AS "count"
      FROM "stock_items" i
      WHERE ${Prisma.join(levelConditions, ' AND ')}
      GROUP BY 1, 2`),
    prisma.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH per_item AS (
        SELECT i."id", i."name", i."area"::text AS "area", i."unit", i."active",
          COUNT(*)::int AS "movementCount",
          (COUNT(*) FILTER (WHERE m."type" = 'CONSUMPTION'))::int AS "consumptionCount",
          COALESCE(SUM(m."quantity") FILTER (WHERE m."type" = 'CONSUMPTION'), 0) AS "consumed",
          COALESCE(SUM(m."quantity") FILTER (WHERE m."type" = 'INCOME'), 0) AS "income"
        ${FROM_MOVEMENTS}
        WHERE ${where}
        GROUP BY i."id", i."name", i."area", i."unit", i."active"
      ), ranked AS (
        SELECT per_item.*,
          ROW_NUMBER() OVER (ORDER BY "movementCount" DESC, "name" ASC, "id" ASC) AS "countRank",
          -- Por CANTIDAD DE CONSUMOS (comparable entre productos), nunca por
          -- cantidad consumida: kg y litros no se pueden ordenar entre sí.
          ROW_NUMBER() OVER (ORDER BY "consumptionCount" DESC, "name" ASC, "id" ASC) AS "consumptionRank",
          COUNT(*) OVER () AS "productsWithMovements"
        FROM per_item
      )
      SELECT "id", "name", "area", "unit", "active", "movementCount", "consumptionCount",
        "consumed"::text AS "consumed", "income"::text AS "income",
        "countRank"::int AS "countRank", "consumptionRank"::int AS "consumptionRank",
        "productsWithMovements"::int AS "productsWithMovements"
      FROM ranked
      WHERE "countRank" <= ${STOCK_REPORT_RANKING_LIMIT}
        OR ("consumptionRank" <= ${STOCK_REPORT_RANKING_LIMIT} AND "consumptionCount" > 0)`),
    skipDestinations
      ? Promise.resolve([] as DestinationRow[])
      : prisma.$queryRaw<DestinationRow[]>(Prisma.sql`
      SELECT d."id", d."name", d."type"::text AS "type", d."active", i."unit" AS "unit",
        COUNT(*)::int AS "count", SUM(m."quantity")::text AS "quantity"
      ${FROM_MOVEMENTS}
      LEFT JOIN "consumption_destinations" d ON d."id" = m."destination_id"
      WHERE ${where} AND m."type" = 'CONSUMPTION'
      GROUP BY d."id", d."name", d."type", d."active", i."unit"
      ORDER BY COUNT(*) DESC, d."name" ASC NULLS LAST, i."unit" ASC
      LIMIT ${DESTINATION_ROWS_LIMIT}`),
    prisma.$queryRaw<EmployeeRow[]>(Prisma.sql`
      SELECT e."id", e."display_name" AS "displayName", e."color_hex" AS "colorHex",
        m."type"::text AS "type", COUNT(*)::int AS "count"
      ${FROM_MOVEMENTS}
      LEFT JOIN "employees" e ON e."id" = m."employee_id"
      WHERE ${where}
      GROUP BY e."id", e."display_name", e."color_hex", m."type"`),
  ]);

  // Totales: conteos globales por tipo; cantidades solo agrupadas por unidad.
  const byType = emptyByType();
  for (const row of totalsRows) byType[row.type] += row.count;
  const movementCount = MOVEMENT_TYPES.reduce((sum, type) => sum + byType[type], 0);

  // Nivel actual por área (no depende del período ni del tipo/persona/destino).
  const areas = new Map<'HOUSE' | 'GARDEN', Record<StockLevel, number>>();
  for (const row of levelRows) {
    const entry = areas.get(row.area) ?? { critical: 0, low: 0, ok: 0 };
    entry[row.level] += row.count;
    areas.set(row.area, entry);
  }
  const byArea = (['HOUSE', 'GARDEN'] as const)
    .filter((area) => !filters.area || filters.area === area)
    .map((area) => ({ area, ...(areas.get(area) ?? { critical: 0, low: 0, ok: 0 }) }));
  const sumLevel = (level: StockLevel) => byArea.reduce((sum, row) => sum + row[level], 0);

  const productDto = (row: ProductRow) => ({
    item: { id: row.id, name: row.name, area: row.area, unit: row.unit, active: row.active },
    movementCount: row.movementCount,
    consumptionCount: row.consumptionCount,
    consumed: decimalText(row.consumed),
    income: decimalText(row.income),
  });
  const mostMoved = productRows
    .filter((row) => row.countRank <= STOCK_REPORT_RANKING_LIMIT)
    .sort((a, b) => a.countRank - b.countRank)
    .map(productDto);
  const mostConsumed = productRows
    .filter((row) => row.consumptionRank <= STOCK_REPORT_RANKING_LIMIT && row.consumptionCount > 0)
    .sort((a, b) => a.consumptionRank - b.consumptionRank)
    .map(productDto);

  // Destinos: un grupo por destino (o "sin destino"), cantidades por unidad.
  const destinations: {
    destination: { id: string; name: string; type: 'VEHICLE' | 'SECTOR'; active: boolean } | null;
    count: number;
    byUnit: QuantityByUnit[];
  }[] = [];
  const destinationIndex = new Map<string, (typeof destinations)[number]>();
  for (const row of destinationRows) {
    const key = row.id ?? 'none';
    let entry = destinationIndex.get(key);
    if (!entry) {
      entry = {
        destination:
          row.id && row.name && row.type
            ? { id: row.id, name: row.name, type: row.type, active: row.active ?? false }
            : null,
        count: 0,
        byUnit: [],
      };
      destinationIndex.set(key, entry);
      destinations.push(entry);
    }
    entry.count += row.count;
    entry.byUnit.push({ unit: row.unit, quantity: decimalText(row.quantity) });
  }
  destinations.sort(
    (a, b) =>
      b.count - a.count ||
      Number(a.destination === null) - Number(b.destination === null) ||
      (a.destination?.name ?? '').localeCompare(b.destination?.name ?? '', 'es'),
  );

  // Personas: conteos por tipo; `null` = sin persona asociada (apertura del
  // seed o movimiento registrado por un ADMIN sin empleado vinculado).
  const people = new Map<
    string,
    {
      employee: { id: string; displayName: string; colorHex: string } | null;
      total: number;
      byType: Record<MovementTypeName, number>;
    }
  >();
  for (const row of employeeRows) {
    const key = row.id ?? 'none';
    const entry = people.get(key) ?? {
      employee:
        row.id && row.displayName
          ? { id: row.id, displayName: row.displayName, colorHex: row.colorHex ?? '' }
          : null,
      total: 0,
      byType: emptyByType(),
    };
    entry.byType[row.type] += row.count;
    entry.total += row.count;
    people.set(key, entry);
  }
  const employees = [...people.values()].sort(
    (a, b) =>
      b.total - a.total ||
      Number(a.employee === null) - Number(b.employee === null) ||
      (a.employee?.displayName ?? '').localeCompare(b.employee?.displayName ?? '', 'es'),
  );

  return {
    range: rangeDto(range),
    totals: {
      movements: movementCount,
      income: { count: byType.INCOME, byUnit: unitTotals(totalsRows, 'INCOME') },
      consumption: { count: byType.CONSUMPTION, byUnit: unitTotals(totalsRows, 'CONSUMPTION') },
      adjustments: {
        count: byType.ADJUSTMENT_INCREASE + byType.ADJUSTMENT_DECREASE,
        increase: byType.ADJUSTMENT_INCREASE,
        decrease: byType.ADJUSTMENT_DECREASE,
      },
      openingBalance: { count: byType.OPENING_BALANCE },
    },
    currentLevels: {
      critical: sumLevel('critical'),
      low: sumLevel('low'),
      ok: sumLevel('ok'),
      byArea,
    },
    products: {
      withMovements: productRows[0]?.productsWithMovements ?? 0,
      mostMoved,
      mostConsumed,
    },
    destinations,
    employees,
  };
}

export type StockReportSummary = Awaited<ReturnType<typeof getStockReportSummary>>;

/**
 * `GET /stock/reports/movements`: movimientos del período, paginados en
 * Postgres (más recientes primero). Una sentencia con JOIN para la página
 * (producto, persona y destino — sin N+1) y otra para el total, en paralelo.
 */
export async function listStockReportMovements(
  _actor: StockActor,
  filters: StockReportFilters & { page: number; pageSize: number },
  now = new Date(),
) {
  const range = resolveReportRange(filters.from, filters.to, now);
  const where = movementWhere(filters, range);
  const skip = (filters.page - 1) * filters.pageSize;

  const [rows, totalRows] = await Promise.all([
    prisma.$queryRaw<MovementRow[]>(Prisma.sql`
      SELECT m."id", m."type"::text AS "type", m."quantity"::text AS "quantity",
        m."effective_date" AS "effectiveDate", m."reason", m."created_at" AS "createdAt",
        i."id" AS "itemId", i."name" AS "itemName", i."area"::text AS "itemArea",
        i."unit" AS "itemUnit", i."active" AS "itemActive",
        e."id" AS "employeeId", e."display_name" AS "employeeName", e."color_hex" AS "employeeColor",
        d."id" AS "destinationId", d."name" AS "destinationName", d."type"::text AS "destinationType"
      ${FROM_MOVEMENTS}
      LEFT JOIN "employees" e ON e."id" = m."employee_id"
      LEFT JOIN "consumption_destinations" d ON d."id" = m."destination_id"
      WHERE ${where}
      ORDER BY m."effective_date" DESC, m."created_at" DESC, m."id" DESC
      LIMIT ${filters.pageSize} OFFSET ${skip}`),
    prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "total"
      ${FROM_MOVEMENTS}
      WHERE ${where}`),
  ]);

  const total = totalRows[0]?.total ?? 0;
  return {
    range: rangeDto(range),
    movements: rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: decimalText(row.quantity),
      // `@db.Date`: medianoche UTC = la fecha de calendario (igual que el historial).
      effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      item: {
        id: row.itemId,
        name: row.itemName,
        area: row.itemArea,
        unit: row.itemUnit,
        active: row.itemActive,
      },
      employee:
        row.employeeId && row.employeeName
          ? { id: row.employeeId, displayName: row.employeeName, colorHex: row.employeeColor ?? '' }
          : null,
      destination:
        row.destinationId && row.destinationName && row.destinationType
          ? { id: row.destinationId, name: row.destinationName, type: row.destinationType }
          : null,
    })),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

// ── Exportación CSV (paridad con `exportarCSV()` del prototipo) ─────────────

/** Columnas exactas del prototipo. */
export const STOCK_CSV_COLUMNS = [
  'Fecha',
  'Ítem',
  'Cantidad',
  'Unidad',
  'Persona',
  'Destino',
  'Motivo',
] as const;
/** Tope defensivo: más filas que esto pide acotar el período (nunca se trunca en silencio). */
export const STOCK_CSV_MAX_ROWS = 20_000;

interface CsvRow {
  type: MovementTypeName;
  quantity: string;
  effectiveDate: Date;
  reason: string | null;
  itemName: string;
  itemUnit: string;
  employeeId: string | null;
  employeeName: string | null;
  destinationName: string | null;
}

/**
 * Motivo con los mismos prefijos que escribía el prototipo en `consumos.motivo`
 * (allí era la única forma de distinguir el tipo): `[Admin] ` cuando no hay
 * persona, `[Ingreso] ` en ingresos y "Ajuste al alta/a la baja: ±X u" en
 * ajustes. Acá se DERIVAN del tipo estructurado; nunca se guardan así.
 */
function csvMotivo(row: CsvRow): string {
  if (row.type === 'OPENING_BALANCE') return 'Saldo inicial';
  const quantity = decimalText(row.quantity);
  const reason = row.reason ?? '';
  let text: string;
  if (row.type === 'INCOME') text = `[Ingreso] ${reason}`;
  else if (row.type === 'ADJUSTMENT_INCREASE') {
    text = `Ajuste al alta: +${quantity} ${row.itemUnit}${reason ? ` · ${reason}` : ''}`;
  } else if (row.type === 'ADJUSTMENT_DECREASE') {
    text = `Ajuste a la baja: -${quantity} ${row.itemUnit}${reason ? ` · ${reason}` : ''}`;
  } else text = reason;
  return `${row.employeeId === null ? '[Admin] ' : ''}${text}`.trim();
}

/**
 * Celda CSV entre comillas con `"` duplicadas (igual que el prototipo). Mejora
 * de seguridad interna: una celda que empieza con `= + - @` o tab/CR se
 * antepone con `'` para que una planilla no la ejecute como fórmula.
 */
export function csvCell(value: string): string {
  const safe = /^(?:[\t\r]|\s*[=+\-@])/.test(value) ? `'${value}` : value;
  return `"${safe.split('"').join('""')}"`;
}

/**
 * `GET /stock/reports/movements.csv`: los movimientos del período con los
 * mismos filtros del reporte, en orden cronológico (como el prototipo), con
 * las 7 columnas originales. Una sentencia con JOIN (sin N+1), `LIMIT` de
 * tope + 1 para detectar exceso. Devuelve el texto con BOM UTF-8 (acentos
 * correctos al abrirlo en una planilla).
 */
export async function exportStockReportCsv(
  _actor: StockActor,
  filters: StockReportFilters,
  now = new Date(),
): Promise<{ filename: string; content: string }> {
  const range = resolveReportRange(filters.from, filters.to, now);
  const where = movementWhere(filters, range);
  const rows = await prisma.$queryRaw<CsvRow[]>(Prisma.sql`
    SELECT m."type"::text AS "type", m."quantity"::text AS "quantity",
      m."effective_date" AS "effectiveDate", m."reason",
      i."name" AS "itemName", i."unit" AS "itemUnit",
      m."employee_id" AS "employeeId", e."display_name" AS "employeeName",
      d."name" AS "destinationName"
    ${FROM_MOVEMENTS}
    LEFT JOIN "employees" e ON e."id" = m."employee_id"
    LEFT JOIN "consumption_destinations" d ON d."id" = m."destination_id"
    WHERE ${where}
    ORDER BY m."effective_date" ASC, m."created_at" ASC, m."id" ASC
    LIMIT ${STOCK_CSV_MAX_ROWS + 1}`);
  if (rows.length > STOCK_CSV_MAX_ROWS) {
    throw new ValidationError(
      `Hay más de ${STOCK_CSV_MAX_ROWS} movimientos para exportar. Acotá el período o los filtros.`,
    );
  }
  const lines = [
    STOCK_CSV_COLUMNS.map(csvCell).join(','),
    ...rows.map((row) =>
      [
        row.effectiveDate.toISOString().slice(0, 10),
        row.itemName,
        decimalText(row.quantity),
        row.itemUnit,
        row.employeeName ?? '',
        row.destinationName ?? '',
        csvMotivo(row),
      ]
        .map(csvCell)
        .join(','),
    ),
  ];
  return { filename: 'consumos_lacañada.csv', content: `\uFEFF${lines.join('\n')}` };
}
