/**
 * Representación VISUAL del stock (docs/BUSINESS_RULES.md §7). El nivel y la
 * cantidad sugerida de Compras los calcula SIEMPRE el backend
 * (`item.stockLevel`, `item.suggestedPurchaseQuantity`): acá no se redefine
 * ninguna regla. Solo se calcula el ancho de la barra.
 */

/**
 * Porcentaje de barra (solo representación, tope visual 100%: un ingreso
 * puede dejar el stock por encima del objetivo):
 *  - con objetivo: actual / objetivo;
 *  - producto anterior sin objetivo: la fórmula previa del prototipo,
 *    `min(100, round(stock / (min*2) * 100))`; con mínimo `0` devuelve `null`
 *    y la UI oculta la barra (un 100% fijo sería engañoso).
 */
export function stockBarPercent(
  currentQuantity: string,
  minimumQuantity: string,
  targetQuantity: string | null,
): number | null {
  const current = Number(currentQuantity);
  if (!Number.isFinite(current)) return null;
  const reference = targetQuantity !== null ? Number(targetQuantity) : Number(minimumQuantity) * 2;
  if (!(reference > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((current / reference) * 100)));
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
