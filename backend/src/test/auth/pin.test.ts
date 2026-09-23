import { describe, expect, it } from 'vitest';
import {
  PIN_PATTERN,
  hashPin,
  validatePinPolicy,
  verifyAgainstDummy,
  verifyPin,
} from '../../auth/pin';

describe('validatePinPolicy', () => {
  it('acepta un PIN de exactamente 4 dígitos', () => {
    expect(validatePinPolicy('1937').ok).toBe(true);
  });

  it('acepta un PIN con cero inicial, sin transformarlo', () => {
    const result = validatePinPolicy('0007');
    expect(result.ok).toBe(true);
  });

  it('rechaza menos de 4 dígitos', () => {
    expect(validatePinPolicy('123').ok).toBe(false);
  });

  it('rechaza más de 4 dígitos', () => {
    expect(validatePinPolicy('12345').ok).toBe(false);
  });

  it('rechaza caracteres no numéricos', () => {
    expect(validatePinPolicy('12a4').ok).toBe(false);
    expect(validatePinPolicy('12 4').ok).toBe(false);
    expect(validatePinPolicy('12-4').ok).toBe(false);
  });

  it('rechaza cadena vacía', () => {
    expect(validatePinPolicy('').ok).toBe(false);
  });

  it('PIN_PATTERN es exactamente ^\\d{4}$', () => {
    expect(PIN_PATTERN.test('0000')).toBe(true);
    expect(PIN_PATTERN.test('99999')).toBe(false);
  });
});

describe('hashPin / verifyPin', () => {
  it('hashea y verifica correctamente un PIN válido', async () => {
    const hash = await hashPin('4821');
    expect(hash).not.toContain('4821');
    const valid = await verifyPin(hash, '4821');
    expect(valid).toBe(true);
  });

  it('preserva un PIN con cero inicial exactamente ("0007" nunca se vuelve "7")', async () => {
    const hash = await hashPin('0007');
    expect(await verifyPin(hash, '0007')).toBe(true);
    expect(await verifyPin(hash, '7')).toBe(false);
    expect(await verifyPin(hash, '0000007')).toBe(false);
  });

  it('rechaza el PIN incorrecto contra un hash válido', async () => {
    const hash = await hashPin('4821');
    const valid = await verifyPin(hash, '9999');
    expect(valid).toBe(false);
  });

  it('hashPin lanza (nunca hashea) si el PIN no cumple la política', async () => {
    await expect(hashPin('12')).rejects.toThrow();
    await expect(hashPin('123456')).rejects.toThrow();
    await expect(hashPin('12ab')).rejects.toThrow();
  });

  it('verifyPin nunca lanza ante un hash corrupto — devuelve false', async () => {
    const valid = await verifyPin('esto-no-es-un-hash-argon2', '1234');
    expect(valid).toBe(false);
  });

  it('verifyAgainstDummy nunca lanza, sin importar el PIN', async () => {
    await expect(verifyAgainstDummy('0000')).resolves.toBeUndefined();
    await expect(verifyAgainstDummy('lo que sea')).resolves.toBeUndefined();
  });
});
