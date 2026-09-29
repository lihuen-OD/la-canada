import type { ApiErrorBody } from './types';
import { fallbackMessageForStatus } from './errorMessages';
import { getAccessToken } from '../auth/accessTokenStore';
import { requestRefresh } from '../auth/refreshCoordinator';
import {
  ensureBackendAwake,
  getBackendAvailability,
  markBackendReachable,
  reportBackendUnavailable,
  reportSlowRequest,
} from '../connectivity/backendAvailability';
import {
  BackendUnavailableError,
  NetworkError,
  OfflineError,
  RequestTimeoutError,
  isTransportFailure,
} from './transportErrors';

/**
 * Base relativa, nunca una URL absoluta del backend: en desarrollo la
 * resuelve el proxy de Vite (`vite.config.ts`, `/api` -> `http://localhost:4000`),
 * en producción la resolverá el proxy de Netlify (pendiente de configurar,
 * ver `frontend/README.md`). Nunca depende de una variable `VITE_*`.
 */
const API_BASE_PATH = '/api/v1';

/**
 * Lecturas: si no llegan los headers en este tiempo, se abortan y cuentan
 * como falla de transporte (Etapa 5R). Las escrituras no tienen timeout del
 * cliente: abortarlas no deshace nada en el servidor y solo volvería ambigua
 * una operación que quizás terminaba bien.
 */
export const GET_TIMEOUT_MS = 30_000;
/**
 * Una request sin respuesta después de este tiempo dispara UN health check en
 * paralelo (`reportSlowRequest`): si Render está despertando, el aviso
 * aparece en segundos en lugar de esperar al timeout.
 */
export const SLOW_REQUEST_MS = 4_000;

/** Error HTTP estructurado — refleja `{ error: { message, code } }`, la forma real de todo error del backend. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /**
   * `true` si la respuesta trajo el cuerpo JSON de error del backend: el
   * backend está despierto y respondió. `false` para respuestas de un proxy.
   */
  readonly fromBackend: boolean;

  constructor(status: number, message: string, code: string | undefined, fromBackend = true) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fromBackend = fromBackend;
  }
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (typeof body?.error !== 'object' || body.error === null) throw new Error('sin error');
    const message =
      typeof body.error.message === 'string' && body.error.message.trim()
        ? body.error.message
        : fallbackMessageForStatus(response.status);
    return new ApiError(response.status, message, body.error.code);
  } catch {
    // Respuesta no JSON (proxy, caída del servicio): texto humano por código, nunca el crudo.
    return new ApiError(
      response.status,
      fallbackMessageForStatus(response.status),
      undefined,
      false,
    );
  }
}

/** `fetch` con la clasificación de fallas de transporte y el timeout de lecturas. */
async function send(
  url: string,
  init: RequestInit,
  { isRead, isUpload }: { isRead: boolean; isUpload: boolean },
): Promise<Response> {
  const controller = isRead ? new AbortController() : null;
  let timedOut = false;
  const timeout = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, GET_TIMEOUT_MS)
    : null;
  // Una subida (foto, plano) puede tardar legítimamente: no se la toma como señal de un backend dormido.
  const slow = isUpload ? null : setTimeout(reportSlowRequest, SLOW_REQUEST_MS);
  try {
    return await fetch(url, controller ? { ...init, signal: controller.signal } : init);
  } catch {
    throw timedOut ? new RequestTimeoutError() : new NetworkError();
  } finally {
    if (timeout) clearTimeout(timeout);
    if (slow) clearTimeout(slow);
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
  /**
   * Headers adicionales de ESTA request (p. ej. `Idempotency-Key` de un
   * movimiento de stock). Viajan idénticos en el único reintento tras 401 +
   * refresh: es la misma request técnica, no una operación nueva.
   */
  headers?: Readonly<Record<string, string>>;
  /** Respuestas no JSON: el CSV server-side de Stock (`text`) y las fotos de Mascotas (`blob`). */
  responseType?: 'json' | 'text' | 'blob';
  /**
   * Cuerpo binario (la foto de una mascota) en lugar de `body` JSON, con su
   * propio `Content-Type`. Se reenvía idéntico en el reintento tras 401.
   */
  rawBody?: Blob;
  contentType?: string;
}

/**
 * Cliente HTTP central basado en `fetch` nativo. `credentials: 'include'`
 * siempre: la cookie `HttpOnly` del refresh token viaja en cada request,
 * la use o no ese endpoint puntual — es inofensivo (el backend solo la lee
 * en `/auth/refresh`/`/auth/logout`) y evita tener que recordar agregarlo
 * caso por caso.
 */
async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const {
    method = 'GET',
    body,
    authenticated,
    headers: extraHeaders,
    responseType = 'json',
    rawBody,
    contentType = 'application/json',
  } = options;
  const headers: Record<string, string> = { ...extraHeaders, 'Content-Type': contentType };

  if (authenticated) {
    const token = getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await send(
    `${API_BASE_PATH}${path}`,
    {
      method,
      credentials: 'include',
      headers,
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    },
    { isRead: method === 'GET', isUpload: rawBody !== undefined },
  );

  if (!response.ok) {
    const error = await parseErrorBody(response);
    // 5xx sin el cuerpo del backend: respondió un proxy, el backend no está disponible.
    if (error.status >= 500 && !error.fromBackend) throw new BackendUnavailableError(error.status);
    markBackendReachable();
    throw error;
  }
  markBackendReachable();
  if (response.status === 204) {
    return undefined as T;
  }
  if (responseType === 'blob') return (await response.blob()) as T;
  return (responseType === 'text' ? await response.text() : await response.json()) as T;
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
    if (isTransportFailure(error)) reportBackendUnavailable();
    if (!(error instanceof ApiError) || error.status !== 401 || !options.authenticated) {
      throw error;
    }
    try {
      await requestRefresh();
    } catch (refreshError) {
      // Sesión realmente vencida/revocada (4xx del refresh): se propaga el
      // 401 original tal cual — la pantalla vuelve al login. Una falla de
      // red o un 5xx del refresh (p. ej. el 503 reintentable, Etapa 5P) NO
      // prueba que la sesión terminó: se propaga ese error para que la
      // pantalla ofrezca reintentar en lugar de cerrar la sesión.
      if (refreshError instanceof ApiError && refreshError.status < 500) throw error;
      throw refreshError;
    }
    // Reintento único, con el token ya renovado en accessTokenStore. Mismas
    // `options` (incluidos sus headers): nunca una clave de idempotencia nueva.
    try {
      return await rawRequest<T>(path, options);
    } catch (retryError) {
      if (isTransportFailure(retryError)) reportBackendUnavailable();
      throw retryError;
    }
  }
}

/** Hay un episodio de indisponibilidad abierto: conviene esperar antes de enviar una lectura. */
function backendNeedsWaiting(): boolean {
  const { status } = getBackendAvailability();
  return status !== 'online' && status !== 'idle';
}

/**
 * Etapa 5R — política ante un backend que no responde (ver
 * docs/ARCHITECTURE.md §32):
 *
 * - `GET`: si hay un episodio abierto, espera a que el backend despierte
 *   antes de enviarse (no suma requests a un servidor que no responde); si
 *   falla por transporte, se suma al MISMO despertar compartido y se
 *   reintenta UNA sola vez. Es seguro: una lectura no cambia nada, y la
 *   deduplicación de TanStack Query ocurre antes (una query = una promesa).
 * - `POST`/`PUT`/`PATCH`/`DELETE`: nunca se reintentan ni se demoran por el
 *   despertar. Sin Internet ni siquiera se envían (`OfflineError`). La falla se informa (abre el episodio, aparece el aviso) y se
 *   propaga: el formulario sigue abierto y la persona decide. Las operaciones
 *   con `Idempotency-Key` conservan su flujo manual de "Consultar estado".
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isRead = (options.method ?? 'GET') === 'GET';
  if (!isRead) {
    // Sin Internet, una escritura falla ANTES de salir: nunca queda en cola
    // para mandarse sola al reconectar, y no es ambigua (no se envió).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new OfflineError();
    return attemptWithRefresh<T>(path, options);
  }
  if (backendNeedsWaiting()) await ensureBackendAwake();
  try {
    return await attemptWithRefresh<T>(path, options);
  } catch (error) {
    if (!isTransportFailure(error)) throw error;
    await ensureBackendAwake();
    return attemptWithRefresh<T>(path, options);
  }
}
