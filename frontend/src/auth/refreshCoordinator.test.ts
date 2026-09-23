import { afterEach, describe, expect, it, vi } from 'vitest';

const { refreshSessionMock } = vi.hoisted(() => ({ refreshSessionMock: vi.fn() }));

vi.mock('../api/authApi', () => ({
  refreshSession: refreshSessionMock,
}));

import { clearAccessToken, getAccessToken } from './accessTokenStore';
import { requestRefresh } from './refreshCoordinator';

/** Promesa controlable a mano, para simular una request en vuelo. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('requestRefresh (single-flight)', () => {
  afterEach(() => {
    clearAccessToken();
    refreshSessionMock.mockReset();
  });

  it('dos llamadas concurrentes comparten la misma promesa y un único POST /auth/refresh real', async () => {
    const { promise, resolve } = deferred<{ accessToken: string; expiresIn: number }>();
    refreshSessionMock.mockReturnValue(promise);

    // Simula el doble montaje de efectos de React StrictMode: dos llamadas
    // en el mismo tick, antes de que la primera resuelva.
    const first = requestRefresh();
    const second = requestRefresh();

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);

    resolve({ accessToken: 'token-1', expiresIn: 720 });
    const [tokenA, tokenB] = await Promise.all([first, second]);

    expect(tokenA).toBe('token-1');
    expect(tokenB).toBe('token-1');
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('token-1');
  });

  it('un logout mientras el refresh está en vuelo descarta el resultado — no re-autentica', async () => {
    const { promise, resolve } = deferred<{ accessToken: string; expiresIn: number }>();
    refreshSessionMock.mockReturnValue(promise);

    const pending = requestRefresh();
    clearAccessToken(); // logout — incrementa la época mientras el refresh sigue en vuelo
    resolve({ accessToken: 'token-tardio', expiresIn: 720 });

    await expect(pending).rejects.toThrow();
    expect(getAccessToken()).toBeNull();
  });

  it('si el refresh falla, no queda ningún token y una llamada posterior reintenta de verdad', async () => {
    refreshSessionMock.mockRejectedValueOnce(new Error('sesión inválida'));
    await expect(requestRefresh()).rejects.toThrow('sesión inválida');
    expect(getAccessToken()).toBeNull();

    refreshSessionMock.mockResolvedValueOnce({ accessToken: 'token-2', expiresIn: 720 });
    await expect(requestRefresh()).resolves.toBe('token-2');
    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
  });

  it('una vez resuelto (éxito o falla), una nueva llamada dispara un refresh real nuevo — no queda "pegado" en single-flight', async () => {
    refreshSessionMock.mockResolvedValueOnce({ accessToken: 'token-a', expiresIn: 720 });
    await requestRefresh();
    refreshSessionMock.mockResolvedValueOnce({ accessToken: 'token-b', expiresIn: 720 });
    await requestRefresh();

    expect(refreshSessionMock).toHaveBeenCalledTimes(2);
    expect(getAccessToken()).toBe('token-b');
  });
});
