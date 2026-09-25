import { Prisma } from '../generated/prisma/client';

/**
 * Nivel de stock (Etapa 5C.1) — la única definición de la regla, usada por:
 * (a) el DTO de producto (`serializeItem`), (b) el filtro server-side de
 * `GET /stock/items` vía SQL, y (c) el fake de tests. Ver
 * docs/BUSINESS_RULES.md §7 (regla histórica de la barra del prototipo).
 *
 * Prioridad de las ramas — misma en SQL y en TypeScript:
 *   1. `critical`: saldo <= 0 (incluye (0,0): el saldo vacío es crítico
 *      aunque el mínimo también sea 0 — interpretación documentada, ver
 *      docs/BUSINESS_RULES.md §7);
 *   2. `low`: saldo > 0 y saldo < mínimo;
 *   3. `ok`: saldo > 0 y saldo >= mínimo (la igualdad con el mínimo es "ok").
 *
 * El nivel es una propiedad matemática del producto: los productos
 * inactivos conservan su nivel y no se especializa por estado.
 */
export type StockLevel = 'ok' | 'low' | 'critical';

export function computeStockLevel(
  currentQuantity: string | Prisma.Decimal,
  minimumQuantity: string | Prisma.Decimal,
): StockLevel {
  const current = new Prisma.Decimal(currentQuantity);
  const minimum = new Prisma.Decimal(minimumQuantity);
  if (current.lte(0)) return 'critical';
  if (current.lt(minimum)) return 'low';
  return 'ok';
}

/** Misma regla que `computeStockLevel`, en forma de predicado (uso del fake). */
export function matchesStockLevel(
  currentQuantity: string | Prisma.Decimal,
  minimumQuantity: string | Prisma.Decimal,
  level: StockLevel,
): boolean {
  return computeStockLevel(currentQuantity, minimumQuantity) === level;
}

/**
 * Prefix del SQL de filtro por nivel, reconocido por el fake de tests para
 * implementar `$queryRaw` con la misma semántica (y fallar en voz alta ante
 * cualquier otra consulta). Si cambia este string, cambia también el
 * intérprete del fake — el test de stockLevel lo fija.
 */
export const STOCK_LEVEL_IDS_SQL_PREFIX = 'SELECT "id" FROM "stock_items" WHERE CASE';

/**
 * Prisma no puede expresar una comparación columna-vs-columna
 * (`current_quantity < minimum_quantity`) en el operador `where` del ORM, y
 * el filtro server-side de nivel exige que Postgres evalúe la condición (no
 * cargar el inventario en memoria para filtrar en JavaScript). El SQL es
 * parametrizado: la única entrada es el nivel, elegido por las ramas del
 * `CASE` — sin interpolación de valores.
 */
/**
 * Misma regla que `computeStockLevel`, como expresión SQL sobre el alias
 * `i` de `stock_items` — la usan las agregaciones de reportes (Etapa 5C.2)
 * para contar niveles en Postgres. Sin parámetros: es texto fijo.
 */
export const STOCK_LEVEL_CASE_SQL = Prisma.sql`CASE
      WHEN i."current_quantity" <= 0 THEN 'critical'
      WHEN i."current_quantity" < i."minimum_quantity" THEN 'low'
      ELSE 'ok'
    END`;

export function buildStockLevelIdsSql(level: StockLevel): Prisma.Sql {
  return Prisma.sql`SELECT "id" FROM "stock_items" WHERE CASE ${level}
      WHEN 'critical' THEN "current_quantity" <= 0
      WHEN 'low' THEN "current_quantity" > 0 AND "current_quantity" < "minimum_quantity"
      WHEN 'ok' THEN "current_quantity" > 0 AND "current_quantity" >= "minimum_quantity"
      ELSE false
    END`;
}
