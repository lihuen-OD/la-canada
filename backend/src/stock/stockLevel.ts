import { Prisma } from '../generated/prisma/client';

/**
 * Nivel de stock — la única definición de la regla, usada por: (a) el DTO de
 * producto (`serializeItem`) y el de Inicio, (b) el filtro server-side de
 * `GET /stock/items` y los conteos de reportes vía SQL, y (c) el fake de
 * tests. Ver docs/BUSINESS_RULES.md §7.
 *
 * Tres estados — NORMAL (`ok`), BAJO (`low`) y CRÍTICO (`critical`) — con
 * stock mínimo y stock OBJETIVO (la cantidad a la que se busca llegar al
 * reponer), en este orden, igual en SQL y en TypeScript:
 *   1. `critical`: actual <= mínimo (la igualdad ya es crítica; con mínimo 0,
 *      el saldo 0 es crítico);
 *   2. `ok` si el producto no tiene objetivo (anterior a la columna): sin
 *      objetivo no hay umbral de «bajo» y nunca se inventa uno. La falta de
 *      objetivo se ve en la edición y en la cantidad sugerida de Compras, no
 *      como un estado;
 *   3. `low`: actual <= (mínimo + objetivo) / 2;
 *   4. `ok`: por encima del punto medio (también por encima del objetivo: no
 *      es un máximo).
 *
 * El punto medio nunca se redondea ni se divide: se compara
 * `2 × actual <= mínimo + objetivo`, exacto con decimales (Decimal en
 * TypeScript, NUMERIC en Postgres). El nivel es una propiedad matemática del
 * producto: los inactivos conservan su nivel (Compras e Inicio los excluyen).
 */
export type StockLevel = 'ok' | 'low' | 'critical';

export const STOCK_LEVELS: readonly StockLevel[] = ['critical', 'low', 'ok'];

type DecimalInput = string | Prisma.Decimal;

export function computeStockLevel(
  currentQuantity: DecimalInput,
  minimumQuantity: DecimalInput,
  targetQuantity: DecimalInput | null,
): StockLevel {
  const current = new Prisma.Decimal(currentQuantity);
  const minimum = new Prisma.Decimal(minimumQuantity);
  if (current.lte(minimum)) return 'critical';
  if (targetQuantity === null) return 'ok';
  const target = new Prisma.Decimal(targetQuantity);
  if (current.mul(2).lte(minimum.add(target))) return 'low';
  return 'ok';
}

/** Misma regla que `computeStockLevel`, en forma de predicado (uso del fake). */
export function matchesStockLevel(
  currentQuantity: DecimalInput,
  minimumQuantity: DecimalInput,
  targetQuantity: DecimalInput | null,
  level: StockLevel,
): boolean {
  return computeStockLevel(currentQuantity, minimumQuantity, targetQuantity) === level;
}

/**
 * Cantidad sugerida de Compras: `objetivo − actual`, exacta (Decimal, dos
 * decimales como el resto de los DTO). `null` sin objetivo: la pantalla pide
 * «Completar stock objetivo» en vez de inventar una cantidad. Nunca negativa
 * (por encima del objetivo no hay nada que sugerir). Es una sugerencia: no
 * registra compras ni modifica el stock.
 */
export function computeSuggestedPurchase(
  currentQuantity: DecimalInput,
  targetQuantity: DecimalInput | null,
): string | null {
  if (targetQuantity === null) return null;
  const missing = new Prisma.Decimal(targetQuantity).sub(new Prisma.Decimal(currentQuantity));
  return (missing.lt(0) ? new Prisma.Decimal(0) : missing).toString();
}

/**
 * Prefix del SQL de filtro por nivel, reconocido por el fake de tests para
 * implementar `$queryRaw` con la misma semántica (y fallar en voz alta ante
 * cualquier otra consulta). Si cambia este string, cambia también el
 * intérprete del fake — el test de stockLevel lo fija.
 */
export const STOCK_LEVEL_IDS_SQL_PREFIX = 'SELECT "id" FROM "stock_items" WHERE CASE';

/**
 * Misma regla que `computeStockLevel`, como expresión SQL sobre el alias `i`
 * de `stock_items` (comparación columna-vs-columna, que Prisma no expresa en
 * `where`). La usan el filtro por nivel y las agregaciones de reportes. Sin
 * parámetros: es texto fijo.
 */
export const STOCK_LEVEL_CASE_SQL = Prisma.sql`CASE
      WHEN i."current_quantity" <= i."minimum_quantity" THEN 'critical'
      WHEN i."target_quantity" IS NULL THEN 'ok'
      WHEN i."current_quantity" * 2 <= i."minimum_quantity" + i."target_quantity" THEN 'low'
      ELSE 'ok'
    END`;

/**
 * Ids de los productos de un nivel, evaluado en Postgres (nunca cargar el
 * inventario para filtrar en memoria). El nivel es el único parámetro.
 */
export function buildStockLevelIdsSql(level: StockLevel): Prisma.Sql {
  return Prisma.sql`SELECT "id" FROM "stock_items" WHERE CASE
      WHEN "current_quantity" <= "minimum_quantity" THEN 'critical'
      WHEN "target_quantity" IS NULL THEN 'ok'
      WHEN "current_quantity" * 2 <= "minimum_quantity" + "target_quantity" THEN 'low'
      ELSE 'ok'
    END = ${level}`;
}
