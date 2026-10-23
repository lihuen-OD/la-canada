import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateTaskRequest,
  TaskEmployee,
  TaskFrequency,
  TaskItem,
  TaskSuggestion,
  TaskSuggestionField,
  UpdateTaskRequest,
} from '../../api/taskTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { formatDateWithWeekday } from '../../utils/dateFormat';
import { errorMessageOf } from './dialogErrors';
import {
  EXECUTION_ORDER_HINT,
  EXECUTION_ORDER_MAX,
  FREQUENCY_HINT,
  FREQUENCY_LABEL,
  FREQUENCY_ORDER,
  PAIRED_SUGGESTION,
  SUGGESTION_DROPPED_NOTICE,
  SUGGESTION_HINT,
  SUGGESTION_INPUTS,
  SUGGESTION_LAST_DAY_HINT,
  SUGGESTION_PAIR_ERROR,
} from './taskLabels';
import { useSubmitGuard } from './useSubmitGuard';

const DESCRIPTION_MAX = 200;

/** Misma normalización que el backend (que igual vuelve a validar todo). */
function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const SUGGESTION_FIELDS: readonly TaskSuggestionField[] = [
  'suggestedWeekday',
  'suggestedFirstHalfDay',
  'suggestedSecondHalfDay',
  'suggestedMonthDay',
  'suggestedMonth',
];
/** Valores de los `<select>` de la sugerencia; vacío = sin dato. */
type SuggestionForm = Record<TaskSuggestionField, string>;

const suggestionFormOf = (task?: TaskSuggestion): SuggestionForm =>
  Object.fromEntries(
    SUGGESTION_FIELDS.map((field) => [field, task?.[field] != null ? String(task[field]) : '']),
  ) as SuggestionForm;

/** Al cambiar de frecuencia se conserva solo lo que la nueva admite (el backend hace lo mismo). */
function keepValidSuggestion(
  values: SuggestionForm,
  frequency: TaskFrequency | '',
): SuggestionForm {
  const kept = suggestionFormOf();
  for (const input of frequency ? SUGGESTION_INPUTS[frequency] : []) {
    if (input.options.some((option) => String(option.value) === values[input.field])) {
      kept[input.field] = values[input.field];
    }
  }
  return kept;
}

const ORDER_ERROR = `El orden de realización debe ser un número entero de 1 a ${EXECUTION_ORDER_MAX}.`;

function validateDescription(value: string): string | null {
  if (value.length < 3) return 'La descripción debe tener al menos 3 caracteres.';
  if (value.length > DESCRIPTION_MAX)
    return `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;
  if (/[<>]/.test(value)) return 'La descripción no puede contener HTML.';
  return null;
}

interface TaskFormDialogProps {
  /** Sin `task`: creación. Con `task`: edición (solo se envían los campos que cambiaron). */
  task?: TaskItem;
  employees: TaskEmployee[];
  onCancel: () => void;
  onCreate: (body: CreateTaskRequest) => Promise<void>;
  onUpdate: (taskId: string, body: UpdateTaskRequest) => Promise<void>;
  /** Solo en edición (ADMIN): abre la confirmación de eliminación definitiva. */
  onDelete?: (task: TaskItem) => void;
}

export function TaskFormDialog({
  task,
  employees,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
}: TaskFormDialogProps) {
  const titleId = useId();
  const [description, setDescription] = useState(task?.description ?? '');
  const [employeeId, setEmployeeId] = useState(task?.assignee.id ?? '');
  const [frequency, setFrequency] = useState<TaskFrequency | ''>(task?.frequency ?? '');
  // `value` del `<input type="date">` (ISO); vacío = sin fecha. Se conserva si
  // se elige otra frecuencia y se vuelve a «Una vez» antes de guardar.
  const [scheduledDate, setScheduledDate] = useState(task?.scheduledDate ?? '');
  const [executionOrder, setExecutionOrder] = useState(
    task?.executionOrder != null ? String(task.executionOrder) : '',
  );
  const [suggestion, setSuggestion] = useState<SuggestionForm>(() => suggestionFormOf(task));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const isEdit = task !== undefined;
  const hint = frequency ? FREQUENCY_HINT[frequency] : undefined;
  const oneTime = frequency === 'ONE_TIME';
  const suggestionInputs = frequency ? SUGGESTION_INPUTS[frequency] : [];
  // Editar y cambiar la frecuencia: se avisa si se pierde parte de la sugerencia.
  const suggestionDropped =
    task !== undefined &&
    frequency !== task.frequency &&
    SUGGESTION_FIELDS.some((field) => task[field] !== null && suggestion[field] === '');

  // Un responsable reasignado a alguien que ya no está activo sigue
  // apareciendo como opción actual (no se puede "perder" en el select), pero
  // el backend rechaza reasignar a un empleado inactivo.
  const options =
    task && !employees.some((employee) => employee.id === task.assignee.id)
      ? [...employees, task.assignee]
      : employees;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = normalizeDescription(description);
    const problem = validateDescription(normalized);
    if (problem) return setErrorMessage(problem);
    if (!employeeId) return setErrorMessage('Elegí un responsable.');
    if (!frequency) return setErrorMessage('Elegí una frecuencia.');

    const orderText = executionOrder.trim();
    const order = orderText === '' ? null : Number(orderText);
    if (
      order !== null &&
      !(/^\d+$/.test(orderText) && order >= 1 && order <= EXECUTION_ORDER_MAX)
    ) {
      return setErrorMessage(ORDER_ERROR);
    }
    // Solo los datos de sugerencia que muestra la frecuencia elegida.
    const suggested = Object.fromEntries(
      SUGGESTION_INPUTS[frequency].map((input) => [
        input.field,
        suggestion[input.field] === '' ? null : Number(suggestion[input.field]),
      ]),
    ) as Partial<Record<TaskSuggestionField, number | null>>;
    if (
      PAIRED_SUGGESTION.has(frequency) &&
      (suggested.suggestedMonth === null) !== (suggested.suggestedMonthDay === null)
    ) {
      return setErrorMessage(SUGGESTION_PAIR_ERROR);
    }

    // Solo una «Una vez» lleva fecha. Al pasar a otra frecuencia no se envía:
    // el backend la quita en la misma transacción.
    const date = frequency === 'ONE_TIME' ? scheduledDate || null : null;

    void run(async () => {
      setErrorMessage(null);
      try {
        if (!task) {
          await onCreate({
            description: normalized,
            employeeId,
            frequency,
            ...(date ? { scheduledDate: date } : {}),
            ...(order !== null ? { executionOrder: order } : {}),
            ...Object.fromEntries(Object.entries(suggested).filter(([, value]) => value !== null)),
          });
          return;
        }
        const changes: UpdateTaskRequest = {};
        if (normalized !== task.description) changes.description = normalized;
        if (employeeId !== task.assignee.id) changes.employeeId = employeeId;
        if (frequency !== task.frequency) changes.frequency = frequency;
        // `null` quita la fecha; omitida la deja como está.
        if (frequency === 'ONE_TIME' && date !== task.scheduledDate) changes.scheduledDate = date;
        // Orden y sugerencia: solo lo que cambió (`null` quita). Lo que la
        // frecuencia nueva no admite no se envía: el backend lo limpia.
        if (order !== task.executionOrder) changes.executionOrder = order;
        for (const [field, value] of Object.entries(suggested) as [
          TaskSuggestionField,
          number | null,
        ][]) {
          if (value !== task[field]) changes[field] = value;
        }
        if (Object.keys(changes).length === 0) {
          onCancel();
          return;
        }
        await onUpdate(task.id, changes);
      } catch (error) {
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (!isSubmitting) onCancel();
  }

  return (
    <Modal titleId={titleId} onRequestClose={handleCancel} closeDisabled={isSubmitting}>
      <form className="dialog dialog--prototype" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {isEdit ? 'Editar tarea' : 'Nueva tarea'}
        </h2>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-description`}>
            Descripción
          </label>
          <input
            id={`${titleId}-description`}
            className="field__input"
            type="text"
            maxLength={DESCRIPTION_MAX}
            autoComplete="off"
            value={description}
            disabled={isSubmitting}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrorMessage(null);
            }}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-employee`}>
            Responsable
          </label>
          <select
            id={`${titleId}-employee`}
            className="field__input"
            value={employeeId}
            disabled={isSubmitting}
            onChange={(event) => {
              setEmployeeId(event.target.value);
              setErrorMessage(null);
            }}
          >
            <option value="">Elegí una persona</option>
            {options.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-frequency`}>
            Frecuencia
          </label>
          <select
            id={`${titleId}-frequency`}
            className="field__input"
            value={frequency}
            disabled={isSubmitting}
            aria-describedby={hint ? `${titleId}-frequency-hint` : undefined}
            onChange={(event) => {
              const next = event.target.value as TaskFrequency | '';
              setFrequency(next);
              setSuggestion((current) => keepValidSuggestion(current, next));
              setErrorMessage(null);
            }}
          >
            <option value="">Elegí una frecuencia</option>
            {FREQUENCY_ORDER.map((value) => (
              <option key={value} value={value}>
                {FREQUENCY_LABEL[value]}
              </option>
            ))}
          </select>
          {hint ? (
            <p className="field__hint" id={`${titleId}-frequency-hint`}>
              {hint}
            </p>
          ) : null}
          {suggestionDropped ? (
            <p className="field__hint" role="status">
              {SUGGESTION_DROPPED_NOTICE}
            </p>
          ) : null}
        </div>

        {suggestionInputs.length > 0 ? (
          <div className="field">
            <div className={suggestionInputs.length > 1 ? 'field-row' : undefined}>
              {suggestionInputs.map((input) => (
                <div className="field" key={input.field}>
                  <label className="field__label" htmlFor={`${titleId}-${input.field}`}>
                    {input.label}
                  </label>
                  <select
                    id={`${titleId}-${input.field}`}
                    className="field__input"
                    value={suggestion[input.field]}
                    disabled={isSubmitting}
                    aria-describedby={`${titleId}-suggestion-hint`}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSuggestion((current) => ({ ...current, [input.field]: value }));
                      setErrorMessage(null);
                    }}
                  >
                    <option value="">Sin sugerencia</option>
                    {input.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="field__hint" id={`${titleId}-suggestion-hint`}>
              {frequency === 'WEEKLY'
                ? SUGGESTION_HINT
                : `${SUGGESTION_HINT} ${SUGGESTION_LAST_DAY_HINT}`}
            </p>
          </div>
        ) : null}

        {oneTime ? (
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-scheduled-date`}>
              Fecha para realizar
            </label>
            <input
              id={`${titleId}-scheduled-date`}
              className="field__input"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={scheduledDate}
              disabled={isSubmitting}
              aria-describedby={`${titleId}-scheduled-date-hint`}
              onChange={(event) => {
                setScheduledDate(event.target.value);
                setErrorMessage(null);
              }}
            />
            <p className="field__hint" id={`${titleId}-scheduled-date-hint`}>
              {scheduledDate
                ? formatDateWithWeekday(scheduledDate)
                : 'Opcional. Puede ser una fecha pasada si ya está atrasada.'}
            </p>
          </div>
        ) : null}

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-execution-order`}>
            Orden de realización
          </label>
          <input
            id={`${titleId}-execution-order`}
            className="field__input"
            type="number"
            inputMode="numeric"
            min={1}
            max={EXECUTION_ORDER_MAX}
            step={1}
            value={executionOrder}
            disabled={isSubmitting}
            aria-describedby={`${titleId}-execution-order-hint`}
            onChange={(event) => {
              setExecutionOrder(event.target.value);
              setErrorMessage(null);
            }}
          />
          <p className="field__hint" id={`${titleId}-execution-order-hint`}>
            {EXECUTION_ORDER_HINT}
          </p>
        </div>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {errorMessage ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {errorMessage}
            </span>
          ) : null}
        </div>

        <div className="dialog__actions">
          <Button variant="secondary" onClick={handleCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear tarea'}
          </Button>
        </div>

        {task && onDelete ? (
          <div className="danger-zone">
            <p className="danger-zone__text">
              ¿Se creó por error? Eliminarla es definitivo y solo es posible si nunca se completó.
              Si ya tiene historial, desactivala desde el listado.
            </p>
            <Button
              variant="danger"
              size="sm"
              disabled={isSubmitting}
              onClick={() => onDelete(task)}
            >
              Eliminar tarea
            </Button>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
