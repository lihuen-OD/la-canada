import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchEmployeePerformance, fetchPerformance } from '../../api/performanceApi';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { TasksSubnav } from './TasksSubnav';

type Preset = 7 | 30 | 90;
const localDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const presetRange = (days: Preset) => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return { from: localDate(from), to: localDate(to) };
};
const percentageLabel = (value: number | null) =>
  value === null ? 'Sin datos' : `${value.toLocaleString('es-AR')}%`;

const isUnauthorized = (reason: unknown) =>
  Boolean(reason && typeof reason === 'object' && 'status' in reason && reason.status === 401);

/**
 * 📊 Desempeño (Etapa 4B). Datos (Etapa 5P): resumen cacheado por rango y
 * detalle por persona+rango (`queryKeys.performance`), con frescura de
 * métricas. Cambiar de período conserva el resumen anterior visible hasta
 * que llega el nuevo; completar o revertir tareas lo invalida.
 */
export function PerformanceScreen() {
  const { user, logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const [preset, setPreset] = useState<Preset>(7);
  const [selected, setSelected] = useState<string | null>(null);
  const range = presetRange(preset);

  const summary = useQuery({
    queryKey: queryKeys.performance.summary(userId, range.from, range.to),
    queryFn: () => fetchPerformance(range.from, range.to),
    enabled,
    staleTime: STALE_TIME.metrics,
    placeholderData: keepPreviousData,
  });
  const detailQuery = useQuery({
    queryKey: queryKeys.performance.employee(userId, selected ?? '', range.from, range.to),
    queryFn: () => fetchEmployeePerformance(selected ?? '', range.from, range.to),
    enabled: enabled && selected !== null,
    staleTime: STALE_TIME.metrics,
  });

  const unauthorized = isUnauthorized(summary.error);
  useEffect(() => {
    if (unauthorized) void logout();
  }, [unauthorized, logout]);

  const data = summary.data ?? null;
  const error = !data && summary.isError;
  const detail = detailQuery.data ?? null;
  const load = () => void summary.refetch();

  return (
    <div className="performance">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📊 </span>Desempeño
          </>
        }
        description="Cumplimiento de las tareas recurrentes y trabajo realizado, con cada número verificable."
        refreshing={Boolean(data) && summary.isFetching}
      />
      <TasksSubnav />
      <div className="filter-scroller" aria-label="Período">
        {([7, 30, 90] as const).map((days) => (
          <Chip
            key={days}
            selected={preset === days}
            onSelect={() => {
              setSelected(null);
              setPreset(days);
            }}
          >
            {days === 7 ? 'Esta semana' : `Últimos ${days} días`}
          </Chip>
        ))}
      </div>
      {error ? (
        <Card>
          <ErrorState title="No pudimos cargar el desempeño." onRetry={load} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Calculando desempeño…" />
        </Card>
      ) : (
        <>
          {data.range.includesCurrentDay ? (
            <p className="performance__note">
              El día de hoy está en curso: solo cuenta lo esperado hasta este momento.
            </p>
          ) : null}
          <section
            className={`performance__summary${summary.isPlaceholderData ? ' is-stale' : ''}`}
            aria-label="Resumen"
            aria-busy={summary.isFetching || undefined}
          >
            <Card>
              <span>Cumplimiento</span>
              <strong>{percentageLabel(data.team.percentage)}</strong>
            </Card>
            <Card>
              <span>📅 Esperadas</span>
              <strong>{data.team.expected}</strong>
            </Card>
            <Card>
              <span>✅ Completadas</span>
              <strong>{data.team.completed}</strong>
            </Card>
            <Card>
              <span>🤝 Coberturas</span>
              <strong>{data.team.coveredOthers}</strong>
            </Card>
            {data.special.urgentPending !== null ? (
              <Card>
                <span>🚨 Urgentes pendientes</span>
                <strong>{data.special.urgentPending}</strong>
              </Card>
            ) : null}
          </section>
          <Card>
            <h2>{user?.role === 'ADMIN' ? 'Equipo' : 'Mi desempeño'}</h2>
            {data.employees.length === 0 ? (
              <EmptyState title="Sin información para este período." />
            ) : (
              <ul className="performance-list">
                {data.employees.map((row) => (
                  <li key={row.employee.id}>
                    <button
                      type="button"
                      className="performance-person"
                      onClick={() => setSelected(row.employee.id)}
                    >
                      <Avatar name={row.employee.displayName} colorHex={row.employee.colorHex} />
                      <span className="performance-person__identity">
                        <strong>{row.employee.displayName}</strong>
                        <small>{row.employee.role}</small>
                      </span>
                      <span className="performance-person__score">
                        <strong>{percentageLabel(row.percentage)}</strong>
                        <small>
                          {row.completed}/{row.expected}
                        </small>
                      </span>
                      <progress
                        max="100"
                        value={row.percentage ?? 0}
                        aria-label={`Cumplimiento de ${row.employee.displayName}: ${percentageLabel(row.percentage)}`}
                      />
                      <span className="performance-person__facts">
                        Realizó {row.performed} · Cubrió {row.coveredOthers} · Recibió ayuda{' '}
                        {row.receivedHelp} · 🔥{' '}
                        {row.dailyStreak === null ? 'Sin datos' : `${row.dailyStreak} días`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {selected && detail ? (
            <Card>
              <div className="performance-detail__header">
                <h2>Detalle</h2>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setSelected(null)}
                >
                  Cerrar
                </button>
              </div>
              <ul className="performance-detail">
                {detail.occurrences?.map((item) => (
                  <li key={`${item.taskId}-${item.periodKey}`}>
                    <span>
                      <strong>{item.description}</strong>
                      <small>
                        {item.periodKey} · {item.frequency} · asignada a{' '}
                        {item.assignedEmployee?.displayName ?? 'Sin responsable'}
                        {item.completedByEmployee
                          ? ` · realizada por ${item.completedByEmployee.displayName}`
                          : ''}
                      </small>
                    </span>
                    <span>{item.completed ? '✅ Completada' : 'Pendiente'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
