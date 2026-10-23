import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { DashboardResponse } from '../api/dashboardTypes';
import type { PerformanceResponse } from '../api/performanceTypes';
import { queryKeys } from '../api/queryKeys';
import type { TasksListResponse } from '../api/taskTypes';
import { useSessionScope } from '../api/useSessionScope';
import {
  getBusinessToday,
  reportServerDay,
  startBusinessDayClock,
  subscribeToBusinessDay,
  subscribeToDayCheck,
} from '../connectivity/businessDay';

const startsWith = (key: QueryKey, prefix: QueryKey) =>
  prefix.every((part, index) => key[index] === part);

const instant = (iso: string | undefined) => {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(time) ? time : null;
};

/**
 * Conecta el reloj del día de negocio (`connectivity/businessDay.ts`) con la
 * caché de ✅ Tareas, Inicio y Desempeño. Se monta UNA vez dentro del área
 * autenticada (`AppShell`), nunca por pantalla:
 *
 * - cada respuesta exitosa del listado de tareas, de Inicio o de Desempeño
 *   informa al reloj la fecha de negocio del servidor (y su hora): el día
 *   solo cambia cuando el backend lo confirma;
 * - a la medianoche (o al volver a la pestaña o a la conexión después de
 *   ella), el reloj pide confirmación: se revalidan esas mismas consultas
 *   si están en pantalla (sin cancelar una que ya esté en vuelo);
 * - cuando el backend confirma el día nuevo, se revalida todo lo que depende
 *   de «hoy» y es anterior a esa confirmación: listados e historial de
 *   Tareas, Inicio y Desempeño (este además cambia su rango con
 *   `useBusinessToday`). Una respuesta que llega con el día ya superado se
 *   vuelve a pedir una vez.
 *
 * Invalidar no desmonta nada: los formularios abiertos y lo que se escribió
 * quedan intactos. Sin conexión, TanStack Query pausa la revalidación hasta
 * reconectar, y ninguna escritura se reenvía sola.
 */
export function BusinessDayRefresh(): null {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();

  useEffect(() => {
    const reporting = [
      queryKeys.tasks.listAll(userId),
      queryKeys.dashboard(userId),
      queryKeys.performance.all(userId),
    ];
    const dayDependent = [
      ...reporting,
      queryKeys.tasks.historyAll(userId),
      // Fechas sugeridas del calendario: dependen del período vigente.
      queryKeys.tasks.calendarAll(userId),
    ];

    /**
     * Fecha (y hora) del servidor que trae cada respuesta que depende del
     * día; `null` si no la trae (p. ej. un backend anterior a §39.1).
     */
    const serverDayOf = (key: QueryKey, data: unknown) => {
      let day: string | undefined;
      let time: string | undefined;
      if (startsWith(key, queryKeys.tasks.listAll(userId))) {
        const { period } = (data ?? {}) as Partial<TasksListResponse>;
        day = period?.today;
        time = period?.generatedAt;
      } else if (startsWith(key, queryKeys.dashboard(userId))) {
        const dashboard = (data ?? {}) as Partial<DashboardResponse>;
        day = dashboard.today;
        time = dashboard.generatedAt;
      } else if (startsWith(key, queryKeys.performance.all(userId))) {
        const performance = (data ?? {}) as Partial<PerformanceResponse>;
        day = performance.range?.today;
        time = performance.generatedAt;
      }
      return day ? { day, time: instant(time) } : null;
    };

    // Una respuesta con el día ya superado se vuelve a pedir UNA vez por día confirmado.
    const staleRetried = new Map<string, string>();
    const stopReports = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) {
        return;
      }
      const report = serverDayOf(event.query.queryKey, event.query.state.data);
      if (!report) return;
      const status = reportServerDay(report.day, report.time, event.query.state.dataUpdatedAt);
      const today = getBusinessToday();
      if (status === 'stale' && staleRetried.get(event.query.queryHash) !== today) {
        staleRetried.set(event.query.queryHash, today);
        void queryClient.invalidateQueries(
          { queryKey: event.query.queryKey, exact: true },
          { cancelRefetch: false },
        );
      }
    });
    const stopChecks = subscribeToDayCheck(() => {
      for (const queryKey of reporting) {
        void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
      }
    });
    const stopChanges = subscribeToBusinessDay((confirmedAt, change) => {
      // Una corrección de la suposición inicial no deja datos viejos: los datos ya vienen del backend.
      if (change !== 'new-day') return;
      for (const queryKey of dayDependent) {
        void queryClient.invalidateQueries(
          { queryKey, predicate: (query) => query.state.dataUpdatedAt < confirmedAt },
          { cancelRefetch: false },
        );
      }
    });
    return () => {
      stopReports();
      stopChecks();
      stopChanges();
    };
  }, [queryClient, userId]);

  // Después de suscribirse: si al encenderse ya cambió el día, el aviso no se pierde.
  useEffect(() => startBusinessDayClock(), []);

  return null;
}
