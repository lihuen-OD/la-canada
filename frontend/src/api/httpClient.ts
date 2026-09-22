import { getAppEnv } from '../config/env';

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/**
 * Cliente HTTP central basado en `fetch` nativo (sin Axios: no hay una
 * necesidad concreta todavía que lo justifique). No define ningún endpoint
 * de negocio — solo la mecánica genérica de request/response que los
 * módulos futuros van a reutilizar.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;

  const response = await fetch(`${getAppEnv().apiUrl}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Error ${response.status} al llamar a ${path}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
