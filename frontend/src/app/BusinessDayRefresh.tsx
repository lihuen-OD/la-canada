import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import { useSessionScope } from '../api/useSessionScope';
import { startBusinessDayClock, subscribeToBusinessDay } from '../connectivity/businessDay';

/**
 * Cuando empieza un día de negocio nuevo (medianoche, o al volver a la
 * pestaña o a la conexión después de ella), revalida lo que depende de «hoy»
 * en ✅ Tareas e Inicio: el listado (período vigente de cada frecuencia y
 * estado de las «Una vez» con fecha), el historial (semana vigente) y el
 * Inicio. Desempeño no hace falta: su rango sale de `useBusinessToday`, así
 * que al cambiar el día cambia su clave y se pide una sola vez.
 *
 * Se monta UNA vez dentro del área autenticada (`AppShell`), nunca por
 * pantalla. Invalidar no desmonta nada: los formularios abiertos y lo que se
 * escribió quedan intactos. Sin conexión, TanStack Query pausa la
 * revalidación hasta reconectar, y ninguna escritura se reenvía sola.
 */
export function BusinessDayRefresh(): null {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  // Primero la suscripción y después el reloj: si al encenderse ya cambió el
  // día, el aviso no se pierde.
  useEffect(
    () =>
      subscribeToBusinessDay(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.listAll(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.historyAll(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userId) });
      }),
    [queryClient, userId],
  );
  useEffect(() => startBusinessDayClock(), []);

  return null;
}
