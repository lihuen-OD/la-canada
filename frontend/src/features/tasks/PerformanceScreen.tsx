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
import { formatDate, formatPercentage } from '../../utils/dateFormat';
import { TasksSubnav } from './TasksSubnav';
import { FREQUENCY_LABEL } from './taskLabels';
import type { PerformanceOccurrence } from '../../api/performanceTypes';

/** Rótulo del estado que ya calculó el backend, visto desde la persona del detalle. */
function occurrenceLabel(item: PerformanceOccurrence, personId: string): string {
  if (item.assignedEmployeeId !== personId) return '🤝 Cobertura realizada';
  if (item.status === 'personal') return '✅ Propia';
  if (item.status === 'covered') return '🤝 Cubierta por otra persona';
  return 'Pendiente';
}

type Preset = 7 | 30 | 90;
/** Etiquetas de período del prototipo ("7 días", …); los rangos son los aprobados. */
const PRESET_LABEL: Record<Preset, string> = { 7: '7 días', 30: '30 días', 90: '3 meses' };
type Tone = 'positive' | 'earth' | 'danger' | 'info' | 'neutral';
/** Color del prototipo según cumplimiento: ≥80% verde, ≥50% tierra, resto rojo. Siempre con el número. */
const scoreTone = (value: number | null): Tone =>
  value === null ? 'neutral' : value >= 80 ? 'positive' : value >= 50 ? 'earth' : 'danger';

/** KPI del prototipo (`.kpi`): tarjeta blanca, cifra Fraunces con el color del estado. */
function Kpi({ tone, value, label }: { tone: Tone; value: string | number; label: string }) {
  return (
    <div className={`kpi kpi--${tone}`}>
      <strong className="kpi__value">{value}</strong>
      <span className="kpi__label">{label}</span>
    </div>
  );
}
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
const percentageLabel = formatPercentage;

const isUnauthorized = (reason: unknown) =>
  Boolean(reason && typeof reason === 'object' && 'status' in reason && reason.status === 401);

/**
 * 🏆 Desempeño (Etapa 4B). Datos (Etapa 5P): resumen cacheado por rango y
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
            <span aria-hidden="true">🏆 </span>Desempeño
          </>
        }
        refreshing={Boolean(data) && summary.isFetching}
      />
      <TasksSubnav />
      <div className="filter-scroller" role="group" aria-label="Período">
        {([7, 30, 90] as const).map((days) => (
          <Chip
            key={days}
            selected={preset === days}
            onSelect={() => {
              setSelected(null);
              setPreset(days);
            }}
          >
            {PRESET_LABEL[days]}
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
            <Kpi
              tone={scoreTone(data.team.percentage)}
              value={percentageLabel(data.team.percentage)}
              label="Cumplimiento personal"
            />
            <Kpi tone="info" value={data.team.assigned} label="📅 Asignadas" />
            <Kpi
              tone="positive"
              value={data.team.completedPersonally}
              label="✅ Realizadas personalmente"
            />
            <Kpi tone="info" value={data.team.coverageGiven} label="🤝 Coberturas" />
            <Kpi
              tone={data.team.pending > 0 ? 'earth' : 'positive'}
              value={data.team.pending}
              label="⏳ Pendientes"
            />
            {data.special.urgentPending !== null ? (
              <Kpi
                tone={data.special.urgentPending > 0 ? 'danger' : 'positive'}
                value={data.special.urgentPending}
                label="🚨 Urgentes pendientes"
              />
            ) : null}
          </section>
          <Card
            title={
              <>
                <span aria-hidden="true">📊 </span>
                {user?.role === 'ADMIN' ? 'Cumplimiento por persona' : 'Mi cumplimiento'}
              </>
            }
          >
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
                      <Avatar
                        name={row.employee.displayName}
                        colorHex={row.employee.colorHex}
                        size="sm"
                      />
                      <span className="performance-person__identity">
                        <strong>{row.employee.displayName}</strong>
                        <small>{row.employee.role}</small>
                      </span>
                      <span
                        className={`performance-person__score performance-person__score--${scoreTone(row.percentage)}`}
                      >
                        <strong>{percentageLabel(row.percentage)}</strong>
                        <small>
                          {row.completedPersonally}/{row.assigned}
                        </small>
                      </span>
                      <progress
                        className={`performance-person__bar performance-person__bar--${scoreTone(row.percentage)}`}
                        max="100"
                        value={row.percentage ?? 0}
                        aria-label={`Cumplimiento de ${row.employee.displayName}: ${percentageLabel(row.percentage)}`}
                      />
                      <span className="performance-person__facts">
                        Pendientes {row.pending} · Coberturas recibidas {row.coverageReceived} ·
                        Coberturas realizadas {row.coverageGiven} · 🔥{' '}
                        {row.dailyStreak === null ? 'Sin datos' : `${row.dailyStreak} días`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {selected && detail ? (
            <Card
              title={
                <>
                  <span aria-hidden="true">📋 </span>Detalle
                </>
              }
              actions={
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setSelected(null)}
                >
                  Cerrar
                </button>
              }
            >
              <ul className="performance-detail">
                {detail.occurrences?.map((item) => (
                  <li key={`${item.taskId}-${item.periodKey}`}>
                    <span>
                      <strong>{item.description}</strong>
                      <small>
                        {item.frequency === 'URGENT' || item.frequency === 'ONE_TIME'
                          ? FREQUENCY_LABEL[item.frequency]
                          : `${formatDate(item.periodKey)} · ${FREQUENCY_LABEL[item.frequency]}`}{' '}
                        · asignada a {item.assignedEmployee?.displayName ?? 'Sin responsable'}
                        {item.completedByEmployee
                          ? ` · realizada por ${item.completedByEmployee.displayName}`
                          : ''}
                      </small>
                    </span>
                    <span>{occurrenceLabel(item, selected)}</span>
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
