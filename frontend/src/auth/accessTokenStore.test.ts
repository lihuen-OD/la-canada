import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAccessToken,
  getAccessToken,
  getEpoch,
  setAccessToken,
  subscribeToAccessToken,
} from './accessTokenStore';

describe('accessTokenStore', () => {
  afterEach(() => {
    clearAccessToken();
  });

  it('empieza sin token', () => {
    expect(getAccessToken()).toBeNull();
  });

  it('setAccessToken/getAccessToken/clearAccessToken funcionan de punta a punta', () => {
    setAccessToken('token-de-prueba');
    expect(getAccessToken()).toBe('token-de-prueba');
    clearAccessToken();
    expect(getAccessToken()).toBeNull();
  });

  it('nunca toca localStorage ni sessionStorage', () => {
    const localSpy = vi.spyOn(Storage.prototype, 'setItem');
    setAccessToken('token-de-prueba');
    clearAccessToken();
    expect(localSpy).not.toHaveBeenCalled();
    localSpy.mockRestore();
  });

  it('clearAccessToken incrementa la época — logout descarta refrescos tardíos', () => {
    const before = getEpoch();
    clearAccessToken();
    expect(getEpoch()).toBe(before + 1);
  });

  it('setAccessToken no incrementa la época', () => {
    const before = getEpoch();
    setAccessToken('token-de-prueba');
    expect(getEpoch()).toBe(before);
  });

  it('notifica a los suscriptores en cada cambio, con el valor actual', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAccessToken(listener);

    setAccessToken('token-de-prueba');
    expect(listener).toHaveBeenLastCalledWith('token-de-prueba');

    clearAccessToken();
    expect(listener).toHaveBeenLastCalledWith(null);

    unsubscribe();
    setAccessToken('otro-token');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
