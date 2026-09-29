import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest, ApiError } from './httpClient';
import { NETWORK_ERROR_MESSAGE, fallbackMessageForStatus } from './errorMessages';
import { userMessageForError } from './errorClassification';
import { BackendUnavailableError } from './transportErrors';

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
    // Etapa 5R: un 5xx de proxy es "backend no disponible", no un error del backend.
    const error = await apiRequest('/x', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendUnavailableError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(userMessageForError(error)).not.toMatch(TECHNICAL);
    expect(userMessageForError(error)).not.toMatch(/502|gateway|html/i);
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

  it('el mensaje de red es el acordado: pide revisar antes de repetir una escritura', () => {
    expect(NETWORK_ERROR_MESSAGE).toBe(
      'No pudimos comunicarnos con el servidor. Si estabas guardando cambios, revisá si quedaron registrados antes de volver a intentar.',
    );
  });
});
