/**
 * Representación VISUAL del stock (docs/BUSINESS_RULES.md §7). El nivel
 * (`ok`/`low`/`critical`) lo calcula SIEMPRE el backend y llega en
 * `item.stockLevel` (Etapa 5C.1): acá no se redefine esa regla. Solo se
 * calculan el ancho de la barra y la diferencia de referencia de Compras.
 */

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

/** Decimal canónico del backend (hasta 2 decimales, sin exponente) → centésimos enteros exactos. */
function toCents(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

function fromCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/**
 * Compras: cantidad de REFERENCIA para volver al mínimo,
 * `máximo(mínimo − actual, 0)`. Aritmética exacta en centésimos (nunca
 * float). No es una orden de compra ni modifica stock. `null` si el backend
 * enviara un formato inesperado.
 */
export function purchaseShortfall(currentQuantity: string, minimumQuantity: string): string | null {
  const current = toCents(currentQuantity);
  const minimum = toCents(minimumQuantity);
  if (current === null || minimum === null) return null;
  return fromCents(Math.max(minimum - current, 0));
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
