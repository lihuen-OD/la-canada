import { describe, expect, it } from 'vitest';
import { resolveEnv } from './env';

describe('resolveEnv', () => {
  it('devuelve la URL de la API y el modo cuando VITE_API_URL está definida', () => {
    const result = resolveEnv({
      VITE_API_URL: 'http://localhost:4000/api/v1',
      MODE: 'test',
    } as ImportMetaEnv);

    expect(result.apiUrl).toBe('http://localhost:4000/api/v1');
    expect(result.mode).toBe('test');
  });

  it('lanza un error cuando falta VITE_API_URL', () => {
    expect(() => resolveEnv({ MODE: 'test' } as ImportMetaEnv)).toThrow(/VITE_API_URL/);
  });
});
