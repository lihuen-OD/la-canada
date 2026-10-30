import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';

/**
 * Invalidación de toda mutación de ✅ Tareas (crear, editar, completar,
 * revertir, activar/desactivar, eliminar y la carga olvidada desde
 * Desempeño): listados, historial y calendario de Tareas, Desempeño (todos
 * los rangos y detalles, también los que están en caché sin mostrarse) e
 * Inicio. Nada más: nunca un `invalidateQueries()` global ni 🥬 Huerta.
 */
export function invalidateTaskViews(queryClient: QueryClient, userId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.performance.all(userId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
}
