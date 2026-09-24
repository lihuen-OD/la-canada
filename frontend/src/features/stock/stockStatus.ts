/**
 * Reglas de estado y barra de stock — docs/BUSINESS_RULES.md §7 (mismos
 * umbrales del prototipo, líneas 1014-1015). Las cantidades llegan como
 * strings decimales del backend; para ESTA comparación de display se usan
 * `Number` (el prototipo usaba `parseFloat`), sin efecto en la exactitud
 * del saldo — esa la guarda y calcula el backend.
 */

export type StockLevel = 'ok' | 'low' | 'crit';

/** `crit` si stock ≤ 0; `low` si stock < mínimo (excluyendo el crítico); si no, `ok` (stock === mínimo cuenta como OK). */
export function stockLevel(currentQuantity: string, minimumQuantity: string): StockLevel {
  const current = Number(currentQuantity);
  const minimum = Number(minimumQuantity);
  if (current <= 0) return 'crit';
  if (current < minimum) return 'low';
  return 'ok';
}

/**
 * Porcentaje de barra: `min(100, round(stock / (min*2) * 100))`. Con
 * mínimo `0` la fórmula del prototipo daba siempre 100% (engañoso):
 * acá devuelve `null` y la UI oculta la barra — la información principal
 * es la cantidad y la etiqueta textual de estado.
 */
export function stockBarPercent(currentQuantity: string, minimumQuantity: string): number | null {
  const minimum = Number(minimumQuantity);
  if (!(minimum > 0)) return null;
  const current = Number(currentQuantity);
  if (!Number.isFinite(current)) return null;
  return Math.min(100, Math.max(0, Math.round((current / (minimum * 2)) * 100)));
}

/** `+`/`−`/nada según el efecto del movimiento sobre el saldo (display nomás). */
export function movementSignedPrefix(
  type:
    'INCOME' | 'CONSUMPTION' | 'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE' | 'OPENING_BALANCE',
): string {
  if (type === 'INCOME' || type === 'ADJUSTMENT_INCREASE') return '+';
  if (type === 'CONSUMPTION' || type === 'ADJUSTMENT_DECREASE') return '−';
  return '';
}
