import { describe, expect, it } from 'vitest';
import { normalizePersonName, personNameError } from './personName';

describe('nombre visible (espejo de la validación del backend)', () => {
  it('normaliza y acepta nombres reales en español', () => {
    expect(normalizePersonName('  María   José ')).toBe('María José');
    for (const name of ['Coke', 'Ñandú Peña', 'O’Dwyer', "D'Angelo", 'Ana-Lía', 'María J.']) {
      expect(personNameError(name), name).toBeNull();
    }
  });

  it('rechaza con mensajes en español', () => {
    expect(personNameError('  ')).toBe('Ingresá el nombre.');
    expect(personNameError('A')).toBe('El nombre debe tener al menos 2 letras.');
    expect(personNameError('Ana2')).toMatch(/solo puede tener letras/);
    expect(personNameError('a'.repeat(101))).toMatch(/100 caracteres/);
  });
});
