import { describe, expect, it } from 'vitest';
import { NEUTRAL_AVATAR_COLOR, resolveSafeColor } from './color';

describe('resolveSafeColor', () => {
  it('acepta hex de 6 y 3 dígitos', () => {
    expect(resolveSafeColor('#4a7c59')).toBe('#4a7c59');
    expect(resolveSafeColor('#ABC')).toBe('#ABC');
  });

  it.each([
    null,
    undefined,
    '',
    'red',
    '4a7c59',
    '#12345g',
    '#1234',
    'javascript:alert(1)',
    'url(x)',
  ])('cae al neutro ante un valor inválido: %s', (value) => {
    expect(resolveSafeColor(value)).toBe(NEUTRAL_AVATAR_COLOR);
  });
});
