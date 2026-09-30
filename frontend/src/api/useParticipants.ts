import { useQuery } from '@tanstack/react-query';
import { fetchParticipants } from './participantsApi';
import { STALE_TIME } from './queryClient';
import { queryKeys } from './queryKeys';
import { useSessionScope } from './useSessionScope';

/**
 * Catálogo compartido de participantes (Stock, Gallinero, filtros de
 * reportes): una request por sesión, reutilizada entre pantallas (Etapa 5P).
 */
export function useParticipants(enabled = true) {
  const { userId, enabled: hasSession } = useSessionScope();
  return useQuery({
    queryKey: queryKeys.participants(userId),
    queryFn: fetchParticipants,
    enabled: hasSession && enabled,
    staleTime: STALE_TIME.catalog,
  });
}
