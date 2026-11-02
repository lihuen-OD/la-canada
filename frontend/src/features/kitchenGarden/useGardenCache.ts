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

  /**
   * Siembra, trasplante, corrección, anulación, archivo o lo previsto: el
   * listado de 🥕 Cultivos, las fichas, el catálogo de cultivos y 📝
   * Registros. Nunca las actividades ni el Desempeño de la Huerta.
   */
  const afterCropChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.batchesAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.batchAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.crops(userId) });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.kitchenGarden.cropRecordsAll(userId),
    });
  }, [queryClient, userId]);

  /** Participación agregada o (des)activada: nombres y opciones en todo el módulo. */
  const afterParticipantChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenGarden.all(userId) });
  }, [queryClient, userId]);

  return { afterActivityChange, afterCropChange, afterParticipantChange };
}
