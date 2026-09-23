import type { ApiErrorBody } from './types';
import { getAccessToken } from '../auth/accessTokenStore';
import { requestRefresh } from '../auth/refreshCoordinator';

/**
 * Base relativa, nunca una URL absoluta del backend: en desarrollo la
 * resuelve el proxy de Vite (`vite.config.ts`, `/api` -> `http://localhost:4000`),
 * en producción la resolverá el proxy de Netlify (pendiente de configurar,
 * ver `frontend/README.md`). Nunca depende de una variable `VITE_*`.
 */
const API_BASE_PATH = '/api/v1';

/** Error HTTP estructurado — refleja `{ error: { message, code } }`, la forma real de todo error del backend. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code: string | undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    return new ApiError(response.status, body.error.message, body.error.code);
  } catch {
    return new ApiError(response.status, `Error ${response.status} al llamar a la API.`, undefined);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /**
   * Marca la request como autenticada: agrega `Authorization: Bearer
   * <token>` si hay un access token en memoria, y la hace elegible para el
   * único reintento automático tras un 401 (ver `attemptWithRefresh`).
   * `login-options`/`login`/`refresh`/`logout` nunca deben pasar esto en
   * `true` — no llevan token, y no deben poder disparar la lógica de
   * refresh-y-reintento (evita cualquier posibilidad de loop).
   */
  authenticated?: boolean;
}

/**
 * Cliente HTTP central basado en `fetch` nativo. `credentials: 'include'`
 * siempre: la cookie `HttpOnly` del refresh token viaja en cada request,
 * la use o no ese endpoint puntual — es inofensivo (el backend solo la lee
 * en `/auth/refresh`/`/auth/logout`) y evita tener que recordar agregarlo
 * caso por caso.
 */
async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const { method = 'GET', body, authenticated } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (authenticated) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_PATH}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw await parseErrorBody(response);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Único punto donde se decide si vale la pena reintentar tras un 401:
 * exclusivamente para requests `authenticated: true`, y como máximo una vez
 * por request original — nunca más, sin importar cuántos 401 consecutivos
 * lleguen. Varios 401 simultáneos (de requests distintas) comparten el
 * mismo refresh gracias a que `requestRefresh` es single-flight (ver
 * `auth/refreshCoordinator.ts`) — acá no hace falta ninguna coordinación
 * adicional, solo llamarlo.
 */
async function attemptWithRefresh<T>(path: string, options: RequestOptions): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !options.authenticated) {
      throw error;
    }
    try {
      await requestRefresh();
    } catch {
      // El refresh también falló (sesión realmente vencida, o de red) — no
      // hay nada más que intentar; se propaga el 401 original tal cual.
      throw error;
    }
    // Reintento único, con el token ya renovado en accessTokenStore.
    return rawRequest<T>(path, options);
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return attemptWithRefresh<T>(path, options);
}
