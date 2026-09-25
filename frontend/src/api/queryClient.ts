import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './httpClient';

/**
 * Política de datos del frontend (Etapa 5P) — ver docs/ARCHITECTURE.md,
 * "Rendimiento y caché del frontend". Caché SOLO en memoria (nunca storage),
 * por usuario (`queryKeys.ts`) y vaciada al cambiar de sesión.
 *
 * - `staleTime` por defecto de 30 s: volver a una pantalla recién vista
 *   muestra sus datos al instante y no genera requests; pasado ese tiempo, se
 *   muestran los datos cacheados y se revalidan en segundo plano. Cada
 *   recurso puede pedir más o menos frescura (`STALE_TIME`).
 * - Sin revalidación por foco de ventana: cada cambio de pestaña sería un
 *   request más a Render/Neon sin necesidad operativa; la frescura la dan el
 *   `staleTime`, las invalidaciones tras mutaciones y la reconexión de red.
 * - Reintentos: nunca para errores HTTP (`ApiError`: 4xx es definitivo y el
 *   401 ya tiene su único reintento central tras refresh en `httpClient`), y
 *   como máximo uno ante fallas de red. Las mutaciones jamás se reintentan
 *   automáticamente.
 */
export const STALE_TIME = {
  /** Listados operativos que cambian con el uso diario. */
  operational: 30_000,
  /** Métricas derivadas: costosas de calcular y no cambian segundo a segundo. */
  metrics: 60_000,
  /** Catálogos casi estáticos (categorías, destinos, empleados asignables). */
  catalog: 5 * 60_000,
} as const;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.operational,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => !(error instanceof ApiError) && failureCount < 1,
      },
      mutations: { retry: false },
    },
  });
}
