import { apiRequest } from './httpClient';
import type { LoginOptionsResponse, LoginResponse, MeResponse, RefreshResponse } from './types';

/** Público — nunca `authenticated: true` (ver httpClient.ts). */
export async function fetchLoginOptions(): Promise<LoginOptionsResponse> {
  return apiRequest<LoginOptionsResponse>('/auth/login-options', { method: 'GET' });
}

/**
 * `pin` viaja como string tal cual lo escribió la persona — nunca se
 * convierte a número en ningún punto del frontend (perdería un cero
 * inicial, ej. "0007" -> 7).
 */
export async function login(params: { userId: string; pin: string }): Promise<LoginResponse> {
  return apiRequest<LoginResponse>('/auth/login', { method: 'POST', body: params });
}

/**
 * Nunca `authenticated: true`: el refresh no lleva `Authorization`, viaja
 * únicamente con la cookie `HttpOnly` (`credentials: 'include'`, ya
 * incluido siempre por `httpClient`). Tampoco es elegible para el
 * reintento-tras-401 — evita cualquier posibilidad de loop.
 */
export async function refreshSession(): Promise<RefreshResponse> {
  return apiRequest<RefreshResponse>('/auth/refresh', { method: 'POST' });
}

/** Idempotente en el backend — nunca lanza por "no había sesión". */
export async function logoutSession(): Promise<void> {
  return apiRequest<void>('/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<MeResponse> {
  return apiRequest<MeResponse>('/auth/me', { method: 'GET', authenticated: true });
}
