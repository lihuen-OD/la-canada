import { useEffect } from 'react';
import type { PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getBackendAvailability,
  startConnectivityMonitoring,
  subscribeToBackendAvailability,
} from './backendAvailability';

/**
 * Conecta el coordinador de disponibilidad con el navegador y con la caché
 * (Etapa 5R). Se monta una sola vez, fuera de las rutas:
 *
 * - escucha `online`/`offline`/`visibilitychange` (pausa y reanuda los
 *   reintentos; sin Internet o con la pestaña oculta no hay sondeo);
 * - al volver el backend después de un episodio, revalida UNA vez solo las
 *   queries visibles que quedaron en error (las que estaban esperando ya se
 *   reintentan solas en `httpClient`). Nunca vacía la caché ni toca la sesión.
 */
export function ConnectionStatusProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();

  useEffect(() => startConnectivityMonitoring(), []);

  useEffect(() => {
    let previous = getBackendAvailability().status;
    return subscribeToBackendAvailability(() => {
      const { status } = getBackendAvailability();
      const recovered = status === 'online' && previous !== 'online' && previous !== 'idle';
      previous = status;
      if (!recovered) return;
      void queryClient.refetchQueries({
        type: 'active',
        predicate: (query) => query.state.status === 'error',
      });
    });
  }, [queryClient]);

  return children;
}
