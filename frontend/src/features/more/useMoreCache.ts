import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

/**
 * Invalidaciones selectivas de ☰ Más (Etapa 5X) — nunca un
 * `invalidateQueries()` global. Cada mutación invalida lo que cambia su
 * dato y el resumen de la grilla si afecta un conteo.
 */
export function useMoreCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();
  const invalidate = useCallback(
    (...keys: readonly (readonly unknown[])[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient],
  );

  return {
    afterNewsChange: useCallback(
      () => invalidate(queryKeys.more.news(userId), queryKeys.more.summary(userId)),
      [invalidate, userId],
    ),
    afterEventChange: useCallback(
      () => invalidate(queryKeys.more.events(userId), queryKeys.more.summary(userId)),
      [invalidate, userId],
    ),
    afterPhotoChange: useCallback(
      () => invalidate(queryKeys.more.photos(userId), queryKeys.more.summary(userId)),
      [invalidate, userId],
    ),
    /** Personas: listas de Configuración, selectores de empleados, Usuarios, Tareas (nombres/colores) y cumpleaños. */
    afterEmployeeChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.employees(userId),
          queryKeys.more.team(userId),
          queryKeys.tasks.all(userId),
          queryKeys.admin.users(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
        ),
      [invalidate, userId],
    ),
    /** PIN asignado o cambiado: estado de cuenta en Personas y en Usuarios. */
    afterAccountChange: useCallback(
      () => invalidate(queryKeys.more.employees(userId), queryKeys.admin.users(userId)),
      [invalidate, userId],
    ),
    /** Mi perfil o hijos: el propio perfil, Datos del equipo y los cumpleaños derivados. */
    afterProfileChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.profile(userId),
          queryKeys.more.team(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
        ),
      [invalidate, userId],
    ),
  };
}
