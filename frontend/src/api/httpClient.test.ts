import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './httpClient';

describe('apiRequest', () => {
  beforeEach(() => {
    // Hermético: no depende de que exista un .env real en el entorno donde
    // corren los tests (por ejemplo, un clon fresco en CI).
    vi.stubEnv('VITE_API_URL', 'http://localhost:4000/api/v1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('llama a la URL construida a partir de VITE_API_URL y parsea el JSON de respuesta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest<{ ok: boolean }>('/health');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/health',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('lanza un error cuando la respuesta no es exitosa', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(apiRequest('/health')).rejects.toThrow(/500/);
  });
});
