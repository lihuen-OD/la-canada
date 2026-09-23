import { describe, expect, it } from 'vitest';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  clearedRefreshTokenCookieOptions,
  deriveSecureFlag,
  refreshTokenCookieOptions,
} from '../../config/cookies';

describe('deriveSecureFlag — Secure es obligatoria cuando SameSite=None', () => {
  it('SameSite=none siempre exige Secure, incluso fuera de producción', () => {
    expect(deriveSecureFlag('none', false)).toBe(true);
  });

  it('en producción, Secure siempre es true sin importar SameSite', () => {
    expect(deriveSecureFlag('lax', true)).toBe(true);
    expect(deriveSecureFlag('strict', true)).toBe(true);
  });

  it('fuera de producción con SameSite=lax/strict, Secure puede ser false (localhost sin HTTPS)', () => {
    expect(deriveSecureFlag('lax', false)).toBe(false);
    expect(deriveSecureFlag('strict', false)).toBe(false);
  });
});

describe('refreshTokenCookieOptions / clearedRefreshTokenCookieOptions', () => {
  it('crear y limpiar usan exactamente los mismos atributos, salvo maxAge', () => {
    const created = refreshTokenCookieOptions();
    const cleared = clearedRefreshTokenCookieOptions();
    expect(cleared).toEqual({
      httpOnly: created.httpOnly,
      secure: created.secure,
      sameSite: created.sameSite,
      path: created.path,
    });
    expect(cleared).not.toHaveProperty('maxAge');
  });

  it('httpOnly siempre true (nunca accesible desde JS del navegador)', () => {
    expect(refreshTokenCookieOptions().httpOnly).toBe(true);
  });

  it('el path queda limitado al flujo de autenticación', () => {
    expect(refreshTokenCookieOptions().path).toBe('/api/v1/auth');
  });

  it('el nombre de la cookie es estable', () => {
    expect(REFRESH_TOKEN_COOKIE_NAME).toBe('lc_refresh_token');
  });
});
