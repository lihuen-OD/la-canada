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

  /**
   * Registro nuevo, anulado o con su próxima fecha corregida: ficha/KPIs e
   * historial de esa mascota, listado (último peso e indicadores) y
   * Vencimientos (un cumplimiento o una anulación cambian los pendientes).
   */
  const afterRecordChange = useCallback(
    (petId: string) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.detail(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.records(userId, petId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.listAll(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.dueAll(userId) });
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
      // Activar o desactivar una mascota la suma o la saca de Vencimientos.
      void queryClient.invalidateQueries({ queryKey: queryKeys.pets.dueAll(userId) });
      // Los cumpleaños de mascotas se derivan en ☰ Más → Eventos (Etapa 5X).
      void queryClient.invalidateQueries({ queryKey: queryKeys.more.events(userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.more.summary(userId) });
    },
    [queryClient, userId],
  );

  /**
   * Mascota eliminada: su ficha y su historial se quitan de la caché (no se
   * vuelven a pedir: darían 404); listado, conteos por tipo y cumpleaños se
   * invalidan.
   */
  const afterPetDeleted = useCallback(
    (petId: string) => {
      queryClient.removeQueries({ queryKey: queryKeys.pets.detail(userId, petId) });
      queryClient.removeQueries({ queryKey: queryKeys.pets.records(userId, petId) });
      afterPetChange();
    },
    [queryClient, userId, afterPetChange],
  );

  /** Catálogo de tipos: tipos + listados/fichas (embeben nombre e ícono del tipo). */
  const afterTypeChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pets.typesAll(userId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pets.listAll(userId) });
  }, [queryClient, userId]);

  /**
   * Cambió el día de negocio: los estados de vencimiento (y la edad o el
   * próximo cumpleaños) dependen de «hoy». Revalida solo lo que está en
   * pantalla de la familia de Mascotas.
   */
  const afterDayChange = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.pets.all(userId) });
  }, [queryClient, userId]);

  return { afterRecordChange, afterPetChange, afterPetDeleted, afterTypeChange, afterDayChange };
}
