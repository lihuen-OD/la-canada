import { useEffect, useState, type ReactNode } from 'react';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { ApiError } from '../../api/httpClient';
import {
  fetchEmployeePerformance,
  fetchEmployeePerformancePage,
  fetchPerformance,
} from '../../api/performanceApi';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { registerLateCompletion, revertTaskCompletion } from '../../api/tasksApi';
import type { LateCompletionRequest } from '../../api/taskTypes';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { useBusinessToday } from '../../connectivity/useBusinessToday';
import { APP_ROUTES } from '../../routes/navigation';
import { formatDate, formatPercentage } from '../../utils/dateFormat';
import { isSessionExpired } from './dialogErrors';
import { LateCompletionDialog, type LateCompletionItem } from './LateCompletionDialog';
import {
  OccurrenceRow,
  PagedPerformanceDetail,
  type LateRegistration,
  type PerformanceDetailPages,
  type RowActions,
} from './PerformanceDetail';
import { RevertTaskDialog } from './RevertTaskDialog';
import { TasksSubnav } from './TasksSubnav';
import { invalidateTaskViews } from './taskCache';
import { TASK_NOUN, type ItemNoun } from './taskLabels';
import type { PerformanceOccurrence, PerformanceResponse } from '../../api/performanceTypes';

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
  /** Acciones del detalle; sin ellas (por defecto en otra fuente) no se muestra ninguna. */
  actions?: PerformanceActions;
  /**
   * Detalle con orden, filtros y «Ver más» (solo ✅ Tareas). Sin esto (🥬
   * Huerta), el detalle completo de siempre con `fetchDetail`.
   */
  detailPages?: PerformanceDetailPages;
}

/**
 * Acciones del detalle — SOLO ✅ Tareas: «Marcar como realizada» una
 * obligación que se hizo y no se marcó, deshacer esa carga y el enlace a
 * Tareas de «Una vez» y urgentes. Cuáles filas las tienen lo decide el
 * backend (`lateCompletion`, `lateRegistration.canRevert`, `completeInTasks`);
 * esta pantalla solo las presenta. Una fuente sin `actions` (🥬 Huerta) no
 * muestra ninguna ni usa endpoints o claves de Tareas.
 */
export interface PerformanceActions {
  registerLate: (taskId: string, body: LateCompletionRequest) => Promise<unknown>;
  revert: (taskId: string, executionId: string, reason?: string) => Promise<unknown>;
  /** Lo que una carga o reversión deja desactualizado: lo mismo que completar/revertir en Tareas. */
  invalidate: (queryClient: QueryClient, userId: string) => void;
  /** Dónde se completan «Una vez» y urgentes con su flujo normal. */
  tasksPath: string;
}

const TASKS_PERFORMANCE: PerformanceSource = {
  summaryKey: queryKeys.performance.summary,
  fetchSummary: fetchPerformance,
  detailKey: queryKeys.performance.employee,
  fetchDetail: fetchEmployeePerformance,
  // Funciones diferidas: los endpoints de Tareas solo se tocan al usarlos.
  actions: {
    registerLate: (taskId, body) => registerLateCompletion(taskId, body),
    revert: (taskId, executionId, reason) => revertTaskCompletion(taskId, executionId, reason),
    invalidate: invalidateTaskViews,
    tasksPath: APP_ROUTES.tasks.path,
  },
  detailPages: {
    key: queryKeys.performance.employeeDetail,
    fetchPage: (personId, from, to, filters, cursor) =>
      fetchEmployeePerformancePage(personId, from, to, filters, cursor),
  },
};

type DetailDialog =
  | { type: 'none' }
  | { type: 'late'; item: LateCompletionItem }
  | { type: 'revert'; item: PerformanceOccurrence; late: LateRegistration };

type Notice = { tone: 'positive' | 'danger'; text: string } | null;

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
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const queryClient = useQueryClient();
  const actions = source.actions ?? null;
  const [preset, setPreset] = useState<Preset>(7);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DetailDialog>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);
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
    // Con detalle paginado (✅ Tareas) nunca se pide el detalle completo.
    enabled: enabled && selected !== null && !source.detailPages,
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

  /**
   * Una acción del detalle: sin actualizaciones optimistas (los datos
   * visibles quedan como estaban si falla). Éxito → aviso, cierre e
   * invalidación de todo lo que completar/revertir actualiza en Tareas.
   * Conflicto (otra persona la registró, ya no corresponde) → se actualizan
   * los datos y el diálogo lo explica. Sesión vencida → login. Sin conexión
   * o sin respuesta: el mensaje de `httpClient`; nunca se reintenta solo.
   */
  const rowActions: RowActions | null = actions
    ? {
        isAdmin,
        tasksPath: actions.tasksPath,
        onLate: (item) => {
          setNotice(null);
          setDialog({ type: 'late', item });
        },
        onRevert: (item, late) => {
          setNotice(null);
          setDialog({ type: 'revert', item, late });
        },
      }
    : null;

  async function runAction(
    current: NonNullable<typeof actions>,
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    try {
      await operation();
    } catch (reason) {
      if (isSessionExpired(reason)) void logout();
      if (reason instanceof ApiError && reason.status === 409) {
        current.invalidate(queryClient, userId);
      }
      throw reason;
    }
    setDialog({ type: 'none' });
    setNotice({ tone: 'positive', text: success });
    current.invalidate(queryClient, userId);
  }

  return (
    <div className="performance">
      <PageHeader title={title} refreshing={Boolean(data) && summary.isFetching} />
      {subnav}
      {actions ? (
        <div aria-live="polite" className="tasks__notice">
          {notice ? (
            <p
              role={notice.tone === 'danger' ? 'alert' : 'status'}
              className={`notice notice--${notice.tone}`}
            >
              {notice.tone === 'danger' ? <AlertIcon size="sm" /> : <CheckCircleIcon size="sm" />}
              {notice.text}
            </p>
          ) : null}
        </div>
      ) : null}
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
          {selected && source.detailPages ? (
            <PagedPerformanceDetail
              pages={source.detailPages}
              personId={selected}
              range={range}
              today={data.range.today ?? today}
              actions={rowActions}
              onClose={() => setSelected(null)}
            />
          ) : selected && detail ? (
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
              <ul
                className={
                  actions ? 'performance-detail performance-detail--actions' : 'performance-detail'
                }
              >
                {detail.occurrences?.map((item) => (
                  <OccurrenceRow
                    key={`${item.taskId}-${item.periodKey}`}
                    item={item}
                    personId={selected}
                    timeZone={detail.range.timeZone}
                    actions={rowActions}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}

      {actions && dialog.type === 'late' ? (
        <LateCompletionDialog
          item={dialog.item}
          isAdmin={isAdmin}
          onCancel={() => setDialog({ type: 'none' })}
          onConfirm={(choice) =>
            runAction(
              actions,
              () =>
                actions.registerLate(dialog.item.taskId, {
                  periodKey: dialog.item.periodKey,
                  ...choice,
                }),
              `«${dialog.item.description}» quedó registrada como realizada el ${formatDate(choice.performedOn)}.`,
            )
          }
        />
      ) : null}

      {actions && dialog.type === 'revert' ? (
        <RevertTaskDialog
          description={dialog.item.description}
          execution={dialog.item}
          reasonRequired={isAdmin}
          onCancel={() => setDialog({ type: 'none' })}
          onConfirm={(reason) =>
            runAction(
              actions,
              () => actions.revert(dialog.item.taskId, dialog.late.executionId, reason),
              `«${dialog.item.description}» volvió a quedar pendiente.`,
            )
          }
        />
      ) : null}
    </div>
  );
}
