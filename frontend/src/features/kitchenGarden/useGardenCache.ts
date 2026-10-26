import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

/**
 * Invalidaciones de 🥬 Huerta, acotadas al módulo: nunca ✅ Tareas, Desempeño
 * general ni Inicio (que no muestran nada de la Huerta), y nunca un
 * `invalidateQueries()` global.
 */
export function useGardenCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  /** Actividad creada, editada, (des)activada, completada o revertida. */
  const afterActivityChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.activitiesAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.historyAll(userId) });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.kitchenGarden.performanceAll(userId),
    });
  }, [queryClient, userId]);

  /** Participación agregada o (des)activada: nombres y opciones en todo el módulo. */
  const afterParticipantChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.all(userId) });
  }, [queryClient, userId]);

  return { afterActivityChange, afterParticipantChange };
}
