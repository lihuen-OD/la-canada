const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Fallback neutro cálido (`--ink-500` en `styles/tokens.css`) — mismo valor
 * a propósito: es el único color que se inyecta por `style` en vez de por
 * clase, porque el color real viene del perfil de la persona.
 */
export const NEUTRAL_AVATAR_COLOR = '#7a6e62';

/**
 * Nunca confía ciegamente en `colorHex` (único dato del backend que termina
 * en un atributo `style`): si no tiene forma de color hex estricta, se usa
 * el gris neutro — nunca se interpola un valor sin validar.
 */
export function resolveSafeColor(colorHex: string | null | undefined): string {
  return typeof colorHex === 'string' && HEX_COLOR_PATTERN.test(colorHex)
    ? colorHex
    : NEUTRAL_AVATAR_COLOR;
}

/** Color por defecto de una persona nueva (`<input type="color" value="#4a7c59">` del prototipo). */
export const DEFAULT_PERSON_COLOR = '#4a7c59';

/** Solo `#rrggbb` (lo que acepta `<input type="color">` y el backend). */
export function isPersonColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
