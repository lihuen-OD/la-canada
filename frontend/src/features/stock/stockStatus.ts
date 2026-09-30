/**
 * Representación VISUAL del stock (docs/BUSINESS_RULES.md §7). El nivel y la
 * cantidad sugerida de Compras los calcula SIEMPRE el backend
 * (`item.stockLevel`, `item.suggestedPurchaseQuantity`): acá no se redefine
 * ninguna regla. Solo se calcula el ancho de la barra.
 */

/**
 * Porcentaje de barra: actual / objetivo, limitado a 100% SOLO en la
 * representación (un ingreso puede dejar el stock por encima del objetivo).
 * Sin objetivo (producto anterior) no hay referencia: `null` y la UI oculta
 * la barra y muestra «Stock objetivo pendiente».
 */
export function stockBarPercent(
  currentQuantity: string,
  targetQuantity: string | null,
): number | null {
  if (targetQuantity === null) return null;
  const target = Number(targetQuantity);
  const current = Number(currentQuantity);
  if (!(target > 0) || !Number.isFinite(current)) return null;
  return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
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
