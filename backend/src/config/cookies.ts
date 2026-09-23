import type { CookieOptions } from 'express';
import { config } from './index';

/**
 * Configuración centralizada de la cookie del refresh token — un único
 * lugar para que `res.cookie(...)` (login/refresh) y `res.clearCookie(...)`
 * (logout) usen exactamente los mismos atributos. Si no coinciden, el
 * navegador no borra la cookie al hacer logout (`clearCookie` compara por
 * nombre + path + domain, no solo por nombre).
 *
 * Ver docs/ARCHITECTURE.md, "Cookies y CSRF", para el razonamiento completo
 * sobre SameSite/Secure y el comportamiento distinto entre localhost y
 * producción (Netlify + Render son dominios distintos — cross-site real).
 */
export const REFRESH_TOKEN_COOKIE_NAME = 'lc_refresh_token';

/**
 * `Secure` es obligatoria cuando `SameSite=None` (si no, los navegadores
 * modernos rechazan la cookie directamente) — se deriva acá, nunca se deja
 * como dos valores independientes que alguien podría desincronizar. Pura
 * (no lee `config`) para poder testear la invariante con cualquier
 * combinación, sin depender de qué `NODE_ENV`/`COOKIE_SAME_SITE` esté
 * activo en el proceso que corre los tests.
 */
export function deriveSecureFlag(
  sameSite: CookieOptions['sameSite'],
  isProduction: boolean,
): boolean {
  return sameSite === 'none' || isProduction;
}

/** Atributos comunes a crearla y borrarla — `maxAge` se agrega aparte solo al crearla (ver más abajo). */
function baseCookieOptions(): Omit<CookieOptions, 'maxAge'> {
  return {
    httpOnly: true,
    secure: deriveSecureFlag(config.cookieSameSite, config.isProduction),
    sameSite: config.cookieSameSite,
    // Limitado al flujo de autenticación: el navegador no envía esta cookie
    // en requests a otras rutas de /api/v1.
    path: '/api/v1/auth',
  };
}

export function refreshTokenCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), maxAge: config.refreshTokenTtlSeconds * 1000 };
}

/** Mismos atributos que al crearla, sin `maxAge` — así `clearCookie` la borra de verdad. */
export function clearedRefreshTokenCookieOptions(): CookieOptions {
  return baseCookieOptions();
}
