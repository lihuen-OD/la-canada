import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

/**
 * Invalidaciones selectivas de 🐾 Mascotas (Etapa 5M) — nunca un
 * `invalidateQueries()` global ni fuera del módulo.
 */
export function usePetsCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  /** Registro nuevo o anulado: ficha/KPIs e historial de esa mascota + listado (último peso). */
  const afterRecordChange = useCallback(
    (petId: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.detail(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.records(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.listAll(userId) });
    },
    [queryClient, userId],
  );

  /** Ficha o foto: esa ficha, el listado y los conteos por tipo (chips). */
  const afterPetChange = useCallback(
    (petId?: string) => {
      if (petId)
        void queryClient.invalidateQueries({ queryKey: queryKeys.pets.detail(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.listAll(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.typesAll(userId) });
      // Los cumpleaños de mascotas se derivan en ☰ Más → Eventos (Etapa 5X).
      void queryClient.invalidateQueries({ queryKey: queryKeys.more.events(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.more.summary(userId) });
    },
    [queryClient, userId],
  );

  /** Catálogo de tipos: tipos + listados/fichas (embeben nombre e ícono del tipo). */
  const afterTypeChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pets.typesAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pets.listAll(userId) });
  }, [queryClient, userId]);

  return { afterRecordChange, afterPetChange, afterTypeChange };
}
