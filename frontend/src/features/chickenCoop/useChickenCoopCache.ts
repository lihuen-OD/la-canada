import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

/**
 * Invalidación selectiva del gallinero (Etapa 5G): toda escritura del
 * módulo (recolección, anulación, configuración, alta/baja) cambia KPIs,
 * análisis e historial — y nada fuera del módulo. Nunca un
 * `invalidateQueries()` global.
 */
export function useChickenCoopCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.chickenCoop.all(userId) });
  }, [queryClient, userId]);
}
