import { describe, expect, it } from 'vitest';
import { resolveEnv } from './env';

describe('resolveEnv', () => {
  it('devuelve el modo actual', () => {
    const result = resolveEnv({ MODE: 'test' } as ImportMetaEnv);
    expect(result.mode).toBe('test');
  });

  it('nunca expone VITE_API_URL — ya no forma parte de la configuración pública del frontend', () => {
    const result = resolveEnv({ MODE: 'test' } as ImportMetaEnv) as unknown as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty('apiUrl');
  });
});
