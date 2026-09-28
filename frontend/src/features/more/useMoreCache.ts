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
      () =>
        invalidate(
          queryKeys.more.news(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    afterEventChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    afterPhotoChange: useCallback(
      () => invalidate(queryKeys.more.photos(userId), queryKeys.more.summary(userId)),
      [invalidate, userId],
    ),
    /**
     * 🌳 Jardín: publicar una versión solo cambia el historial del plano y el
     * conteo de la grilla. Las imágenes ya descargadas siguen en caché (cada
     * versión es inmutable) y no se pide ninguna foto del historial.
     */
    afterGardenChange: useCallback(
      () => invalidate(queryKeys.more.garden(userId), queryKeys.more.summary(userId)),
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
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /**
     * Etapa 5F — cambió el nombre visible de un EMPLEADO (él mismo en Mi
     * perfil o el ADMIN en Datos del equipo): todo lo que muestra nombres de
     * personas. Solo se llama si el nombre cambió de verdad.
     */
    afterPersonNameChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.profile(userId),
          queryKeys.more.employees(userId),
          queryKeys.more.team(userId),
          queryKeys.more.news(userId),
          queryKeys.more.photos(userId),
          queryKeys.more.events(userId),
          queryKeys.tasks.all(userId),
          queryKeys.performance.all(userId),
          queryKeys.chickenCoop.all(userId),
          queryKeys.stock.all(userId),
          queryKeys.pets.all(userId),
          queryKeys.admin.users(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /** Etapa 5F — el ADMIN cambió SU nombre visible: su cumpleaños (Eventos, Inicio) y Usuarios. */
    afterOwnNameChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.dashboard(userId),
          queryKeys.admin.users(userId),
        ),
      [invalidate, userId],
    ),
    /** PIN asignado o cambiado: estado de cuenta en Personas y en Usuarios. */
    afterAccountChange: useCallback(
      () => invalidate(queryKeys.more.employees(userId), queryKeys.admin.users(userId)),
      [invalidate, userId],
    ),
    /**
     * 🎂 Mi cumpleaños (perfil personal): los cumpleaños derivados (Eventos,
     * Inicio, Más). El perfil propio NO se invalida: la respuesta del PUT ya
     * se escribió en su caché (`setQueryData`), sin una request extra.
     */
    afterOwnBirthdayChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /** 👨‍👩‍👧‍👦 Mi familia: la lista y los cumpleaños derivados (Eventos, Inicio, Más). */
    afterFamilyChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.family(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
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
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
  };
}
