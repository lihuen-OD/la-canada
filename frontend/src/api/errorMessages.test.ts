import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './httpClient';
import { NETWORK_ERROR_MESSAGE, fallbackMessageForStatus } from './errorMessages';

const TECHNICAL =
  /failed to fetch|network error|unauthorized|forbidden|internal server error|prisma|postgres|sql|api/i;

afterEach(() => vi.unstubAllGlobals());

describe('mensajes de error del frontend', () => {
  it.each([400, 401, 403, 404, 409, 413, 415, 429, 500, 502, 503])(
    '%i sin mensaje utilizable → texto humano en español',
    (status) => {
      const message = fallbackMessageForStatus(status);
      expect(message).toMatch(/[.]$/);
      expect(message).not.toMatch(TECHNICAL);
    },
  );

  it('una respuesta no JSON (proxy caído) nunca muestra el crudo ni "Error 502 al llamar a la API"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })),
    );
    const error = await apiRequest('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Ocurrió un error inesperado. Intentá nuevamente.');
  });

  it('un error JSON sin mensaje usa el texto por código y conserva el código', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 })),
    );
    const error = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('RATE_LIMITED');
    expect(error.message).toBe(
      'Realizaste demasiados intentos. Esperá unos minutos antes de volver a intentar.',
    );
  });

  it('el mensaje de red es el acordado', () => {
    expect(NETWORK_ERROR_MESSAGE).toBe(
      'No pudimos conectar con el servidor. Revisá tu conexión e intentá nuevamente.',
    );
  });
});
