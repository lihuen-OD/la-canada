import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
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
import { useBusinessToday } from '../../connectivity/useBusinessToday';
import { formatDateWithWeekday, formatPercentage } from '../../utils/dateFormat';
import { TasksSubnav } from './TasksSubnav';
import { FREQUENCY_LABEL, TASK_NOUN, formatPeriodKey, type ItemNoun } from './taskLabels';
import type { PerformanceOccurrence, PerformanceResponse } from '../../api/performanceTypes';

/** Rótulo del estado que ya calculó el backend, visto desde la persona del detalle. */
function occurrenceLabel(item: PerformanceOccurrence, personId: string): string {
  if (item.assignedEmployeeId !== personId) return '🤝 Cubrió a otros';
  if (item.status === 'personal') return '✅ Propia';
  if (item.status === 'covered') return '🤝 Le cubrieron';
  return 'Sin completar';
}

/** Únicos rangos públicos de Desempeño (el backend rechaza cualquier otro). */
const PRESETS = [7, 14, 30] as const;
type Preset = (typeof PRESETS)[number];
/** Etiquetas de período del prototipo ("7 días", …); los rangos son los aprobados. */
const PRESET_LABEL: Record<Preset, string> = { 7: '7 días', 14: '14 días', 30: '30 días' };
type Tone = 'positive' | 'earth' | 'danger' | 'info' | 'neutral';
/** Color del prototipo según cumplimiento: ≥80% verde, ≥50% tierra, resto rojo. Siempre con el número. */
const scoreTone = (value: number | null): Tone =>
  value === null ? 'neutral' : value >= 80 ? 'positive' : value >= 50 ? 'earth' : 'danger';

/** KPI del prototipo (`.kpi`): tarjeta blanca, cifra Fraunces con el color del estado. */
function Kpi({ tone, value, label }: { tone: Tone; value: string | number; label: string }) {
  return (
    <div className={`kpi kpi--${tone}`}>
      <strong
        className={
          typeof value === 'string' && !value.endsWith('%')
            ? 'kpi__value kpi__value--text'
            : 'kpi__value'
        }
      >
        {value}
      </strong>
      <span className="kpi__label">{label}</span>
    </div>
  );
}
/**
 * Últimos `days` días hasta hoy en la zona de negocio (aritmética de
 * calendario, nunca la fecha local del navegador). Al empezar otro día de
 * negocio cambia `today`, cambia la clave y el resumen se pide una sola vez.
 */
const presetRange = (days: Preset, today: string) => {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const from = new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10);
  return { from, to: today };
};

/** Período de una obligación: fechas del período, o la fecha para realizar de una «Una vez». */
function occurrencePeriod(item: PerformanceOccurrence): string {
  if (item.frequency === 'ONE_TIME' && item.scheduledDate) {
    return `${FREQUENCY_LABEL.ONE_TIME} · para el ${formatDateWithWeekday(item.scheduledDate)}`;
  }
  return item.frequency === 'URGENT' || item.frequency === 'ONE_TIME'
    ? FREQUENCY_LABEL[item.frequency]
    : `${formatPeriodKey(item.periodKey)} · ${FREQUENCY_LABEL[item.frequency]}`;
}

/**
 * De dónde salen las métricas: ✅ Tareas → Desempeño por defecto; 🥬 Huerta
 * pasa sus endpoints y claves de caché (adaptados a esta forma). La pantalla
 * solo presenta: el backend calcula todo.
 */
export interface PerformanceSource {
  summaryKey: (userId: string, from: string, to: string) => QueryKey;
  fetchSummary: (from: string, to: string) => Promise<PerformanceResponse>;
  detailKey: (userId: string, personId: string, from: string, to: string) => QueryKey;
  fetchDetail: (personId: string, from: string, to: string) => Promise<PerformanceResponse>;
}

const TASKS_PERFORMANCE: PerformanceSource = {
  summaryKey: queryKeys.performance.summary,
  fetchSummary: fetchPerformance,
  detailKey: queryKeys.performance.employee,
  fetchDetail: fetchEmployeePerformance,
};

interface PerformanceScreenProps {
  source?: PerformanceSource;
  /** Pestañas del módulo (por defecto, las de Tareas). */
  subnav?: ReactNode;
  /** «tarea» (por defecto) o «actividad» (🥬 Huerta): textos sin obligaciones. */
  noun?: ItemNoun;
  /** Lista de personas vacía (por defecto, la de Tareas). */
  emptyPeopleTitle?: string;
  /** Título de la pantalla (por defecto, 🏆 Desempeño). */
  title?: ReactNode;
}

const isUnauthorized = (reason: unknown) =>
  Boolean(reason && typeof reason === 'object' && 'status' in reason && reason.status === 401);

/**
 * 🏆 Desempeño (Etapa 4B). Datos (Etapa 5P): resumen cacheado por rango y
 * detalle por persona+rango (`queryKeys.performance`), con frescura de
 * métricas. Cambiar de período conserva el resumen anterior visible hasta
 * que llega el nuevo; completar o revertir tareas lo invalida.
 */
export function PerformanceScreen({
  source = TASKS_PERFORMANCE,
  subnav = <TasksSubnav />,
  noun = TASK_NOUN,
  emptyPeopleTitle = 'Sin información para este período.',
  title = (
    <>
      <span aria-hidden="true">🏆 </span>Desempeño
    </>
  ),
}: PerformanceScreenProps = {}) {
  const percentageLabel = (value: number | null) =>
    value === null ? noun.noObligations : formatPercentage(value);
  const { user, logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const [preset, setPreset] = useState<Preset>(7);
  const [selected, setSelected] = useState<string | null>(null);
  const today = useBusinessToday();
  const range = presetRange(preset, today);

  const summary = useQuery({
    queryKey: source.summaryKey(userId, range.from, range.to),
    queryFn: () => source.fetchSummary(range.from, range.to),
    enabled,
    staleTime: STALE_TIME.metrics,
    placeholderData: keepPreviousData,
  });
  const detailQuery = useQuery({
    queryKey: source.detailKey(userId, selected ?? '', range.from, range.to),
    queryFn: () => source.fetchDetail(selected ?? '', range.from, range.to),
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
      <PageHeader title={title} refreshing={Boolean(data) && summary.isFetching} />
      {subnav}
      <div className="filter-scroller" role="group" aria-label="Período">
        {PRESETS.map((days) => (
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
              label="⏳ Sin completar"
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
              <EmptyState title={emptyPeopleTitle} />
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
                        // Sin tareas: barra neutra vacía (no es un 0% real).
                        value={row.percentage ?? 0}
                        aria-label={`Cumplimiento de ${row.employee.displayName}: ${percentageLabel(row.percentage)}`}
                      />
                      <span className="performance-person__facts">
                        Sin completar {row.pending} · Le cubrieron {row.coverageReceived} · Cubrió a
                        otros {row.coverageGiven}
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
                        {occurrencePeriod(item)} · asignada a{' '}
                        {item.assignedEmployee?.displayName ?? 'Sin responsable'}
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
