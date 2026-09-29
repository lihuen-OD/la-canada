import { QueryClient } from '@tanstack/react-query';

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
 * - Reintentos: TanStack Query no reintenta nada (Etapa 5R). El 401 tiene su
 *   único reintento central tras refresh, y una lectura que falla por
 *   transporte espera al despertar compartido del backend y se reintenta UNA
 *   vez — ambos en `httpClient`. Reintentar también acá multiplicaría las
 *   requests a un servidor que no responde. Las mutaciones jamás se
 *   reintentan automáticamente.
 * - Sin Internet, TanStack Query pausa las queries (`networkMode: 'online'`,
 *   el predeterminado) y las reanuda al reconectar: cero sondeo offline. Las
 *   escrituras, en cambio, nunca se encolan (ver `mutations` abajo).
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
        retry: false,
      },
      // `networkMode: 'always'`: una mutación sin Internet se ejecuta y falla
      // al instante (`OfflineError`), nunca queda en pausa para enviarse sola
      // al reconectar (el modo por defecto, `online`, la encolaría).
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
