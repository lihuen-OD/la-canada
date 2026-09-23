import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  validatePasswordPolicy,
  verifyAgainstDummy,
  verifyPassword,
} from '../../auth/password';

describe('validatePasswordPolicy', () => {
  it('rechaza contraseñas más cortas que el mínimo', () => {
    const result = validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH - 1));
    expect(result.ok).toBe(false);
  });

  it('rechaza contraseñas más largas que el máximo', () => {
    const result = validatePasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1));
    expect(result.ok).toBe(false);
  });

  it('acepta una passphrase larga con espacios y acentos, sin exigir mayúsculas/símbolos', () => {
    const result = validatePasswordPolicy('mi frase de acceso segura para la cañada');
    expect(result.ok).toBe(true);
  });

  it('acepta exactamente el mínimo y exactamente el máximo', () => {
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true);
    expect(validatePasswordPolicy('a'.repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true);
  });

  it('rechaza caracteres de control', () => {
    const result = validatePasswordPolicy(`contraseña-valida-1234\x00`);
    expect(result.ok).toBe(false);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('hashea y verifica correctamente una contraseña válida', async () => {
    const hash = await hashPassword('una contraseña bastante larga y segura');
    expect(hash).not.toContain('una contraseña');
    const valid = await verifyPassword(hash, 'una contraseña bastante larga y segura');
    expect(valid).toBe(true);
  });

  it('rechaza la contraseña incorrecta contra un hash válido', async () => {
    const hash = await hashPassword('una contraseña bastante larga y segura');
    const valid = await verifyPassword(hash, 'otra contraseña completamente distinta');
    expect(valid).toBe(false);
  });

  it('hashPassword lanza (nunca hashea) si la contraseña no cumple la política', async () => {
    await expect(hashPassword('corta')).rejects.toThrow();
  });

  it('verifyPassword nunca lanza ante un hash corrupto — devuelve false', async () => {
    const valid = await verifyPassword('esto-no-es-un-hash-argon2', 'cualquier-cosa');
    expect(valid).toBe(false);
  });

  it('verifyAgainstDummy nunca lanza, sin importar la contraseña', async () => {
    await expect(verifyAgainstDummy('lo que sea')).resolves.toBeUndefined();
  });
});
