import { useCallback, useEffect, useId, useState } from 'react';
import { fetchTaskHistory } from '../../api/tasksApi';
import type { HistoryTask, TaskExecution, TaskHistoryResponse } from '../../api/taskTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { isSessionExpired } from './dialogErrors';
import {
  FREQUENCY_EMOJI,
  FREQUENCY_LABEL,
  FREQUENCY_TONE,
  formatCompletedAt,
  formatLocalDay,
} from './taskLabels';

const WEEKS_TO_OFFER = 8; // mismas "últimas 8 semanas" que el prototipo

/** Lunes anteriores a partir del lunes vigente que informa el backend (solo para armar el selector). */
function previousMondays(currentWeekStart: string, count: number): string[] {
  const base = new Date(`${currentWeekStart}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() - index * 7);
    return date.toISOString().slice(0, 10);
  });
}

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'loaded'; data: TaskHistoryResponse };

interface TaskHistoryProps {
  currentWeekStart: string;
  today: string;
  /** Filtro por persona compartido con el listado (explícito en el título). */
  employeeId: string | null;
  employeeName: string | null;
  /** Cambia después de cada mutación para volver a pedir el historial. */
  refreshKey: number;
  onRevert: (task: HistoryTask, execution: TaskExecution) => void;
  onSessionExpired: () => void;
}

interface CompletionLine {
  task: HistoryTask;
  execution: TaskExecution;
}

/** `GET /tasks/history` — endpoint propio y liviano, nunca el listado principal. */
export function TaskHistory({
  currentWeekStart,
  today,
  employeeId,
  employeeName,
  refreshKey,
  onRevert,
  onSessionExpired,
}: TaskHistoryProps) {
  const selectId = useId();
  const weeks = previousMondays(currentWeekStart, WEEKS_TO_OFFER);
  const [week, setWeek] = useState(currentWeekStart);
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(() => {
    fetchTaskHistory({
      week: week === currentWeekStart ? undefined : week,
      employeeId: employeeId ?? undefined,
    })
      .then((data) => setState({ status: 'loaded', data }))
      .catch((error: unknown) => {
        if (isSessionExpired(error)) onSessionExpired();
        setState({ status: 'error' });
      });
  }, [week, currentWeekStart, employeeId, onSessionExpired]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  function retry(): void {
    setState({ status: 'loading' });
    load();
  }

  let content;
  if (state.status === 'loading') {
    content = <LoadingState label="Cargando historial…" />;
  } else if (state.status === 'error') {
    content = <ErrorState title="No pudimos cargar el historial." onRetry={retry} />;
  } else {
    const { data } = state;
    const timeZone = data.week.timeZone;
    // Filtro por persona y conteo realizadas/esperadas: los resuelve el backend.
    const { recurring } = data;
    const { expected, completed } = data.summary;
    const lines: CompletionLine[] = [
      ...recurring.flatMap((row) =>
        row.slots.flatMap((slot) =>
          slot.execution ? [{ task: row.task, execution: slot.execution }] : [],
        ),
      ),
      ...data.others,
    ].sort((a, b) => (a.execution.completedAt ?? '').localeCompare(b.execution.completedAt ?? ''));

    content =
      recurring.length === 0 && lines.length === 0 ? (
        <EmptyState
          title="Sin tareas registradas esta semana."
          description="Cuando se completen tareas van a aparecer acá."
        />
      ) : (
        <div className="history">
          {expected > 0 ? (
            <p className="history__summary" role="status">
              <strong>{completed}</strong> de <strong>{expected}</strong> diarias y semanales
              realizadas
            </p>
          ) : null}

          {recurring.length > 0 ? (
            <ul className="history-grid" role="list" aria-label="Diarias y semanales de la semana">
              {recurring.map((row) => (
                <li key={row.task.id} className="history-grid__row">
                  <div className="history-grid__task">
                    <span className="history-grid__description">{row.task.description}</span>
                    <span className="history-grid__meta">
                      <Badge tone={FREQUENCY_TONE[row.task.frequency]}>
                        {FREQUENCY_LABEL[row.task.frequency]}
                      </Badge>
                      {!row.task.active ? <Badge tone="neutral">Desactivada</Badge> : null}
                    </span>
                  </div>
                  <ol className="history-grid__slots">
                    {row.slots.map((slot) => {
                      const day =
                        row.task.frequency === 'DAILY'
                          ? formatLocalDay(slot.periodKey, { month: undefined })
                          : 'Semana';
                      const status = slot.execution
                        ? `completada por ${slot.execution.completedByEmployee?.displayName ?? '—'}`
                        : slot.expected
                          ? 'pendiente'
                          : 'no corresponde';
                      return (
                        <li
                          key={slot.periodKey}
                          className={`history-slot history-slot--${
                            slot.execution ? 'done' : slot.expected ? 'pending' : 'idle'
                          }`}
                        >
                          <span className="history-slot__day" aria-hidden="true">
                            {day}
                          </span>
                          <span className="history-slot__mark" aria-hidden="true">
                            {slot.execution ? '✓' : slot.expected ? '·' : ''}
                          </span>
                          <span className="visually-hidden">
                            {day}: {status}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ul>
          ) : null}

          {lines.length > 0 ? (
            <section aria-labelledby={`${selectId}-lines`}>
              <h3 id={`${selectId}-lines`} className="history__subtitle">
                Finalizaciones de la semana
              </h3>
              <ul className="history-lines" role="list">
                {lines.map(({ task, execution }) => {
                  const emoji = FREQUENCY_EMOJI[task.frequency];
                  const differs =
                    execution.completedByEmployee !== null &&
                    execution.completedByEmployee.id !== execution.assignedEmployee.id;
                  return (
                    <li key={execution.id} className="history-line">
                      <div className="history-line__text">
                        <span className="history-line__description">{task.description}</span>
                        <span className="history-line__meta">
                          <Badge tone={FREQUENCY_TONE[task.frequency]}>
                            {emoji
                              ? `${emoji} ${FREQUENCY_LABEL[task.frequency]}`
                              : FREQUENCY_LABEL[task.frequency]}
                          </Badge>
                          {!task.active ? <Badge tone="neutral">Desactivada</Badge> : null}
                          <span>
                            {differs
                              ? `Asignada a ${execution.assignedEmployee.displayName} · `
                              : ''}
                            Completada por {execution.completedByEmployee?.displayName ?? '—'}
                            {execution.completedAt
                              ? ` · ${formatCompletedAt(execution.completedAt, timeZone, today)}`
                              : ''}
                          </span>
                        </span>
                      </div>
                      {execution.canRevert ? (
                        <Button size="sm" variant="ghost" onClick={() => onRevert(task, execution)}>
                          Corregir<span className="visually-hidden">: {task.description}</span>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      );
  }

  return (
    <Card
      title={
        <>
          <span aria-hidden="true">📅 </span>Historial semanal
          {employeeName ? <span className="history__filter"> · {employeeName}</span> : null}
        </>
      }
      actions={
        <div className="field history__week">
          <label className="visually-hidden" htmlFor={selectId}>
            Semana
          </label>
          <select
            id={selectId}
            className="field__input"
            value={week}
            onChange={(event) => {
              setWeek(event.target.value);
              setState({ status: 'loading' });
            }}
          >
            {weeks.map((monday, index) => (
              <option key={monday} value={monday}>
                {index === 0
                  ? 'Esta semana'
                  : `Semana del ${formatLocalDay(monday, { weekday: undefined })}`}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {content}
    </Card>
  );
}
