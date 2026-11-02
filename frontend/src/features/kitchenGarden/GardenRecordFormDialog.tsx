import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../api/httpClient';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { createGardenActivity, updateGardenActivity } from '../../api/kitchenGardenApi';
import type {
  CreateGardenActivityRequest,
  CreateGardenActivityResponse,
  GardenActivity,
  GardenActivityKind,
  UpdateGardenActivityRequest,
} from '../../api/kitchenGardenTypes';
import type { TaskEmployee, TaskFrequency, TaskSuggestionField } from '../../api/taskTypes';
import { OfflineError } from '../../api/transportErrors';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { formatDateWithWeekday } from '../../utils/dateFormat';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import {
  DESCRIPTION_MAX,
  ORDER_ERROR,
  SUGGESTION_FIELDS,
  keepValidSuggestion,
  normalizeDescription,
  parseExecutionOrder,
  suggestionFormOf,
  validateDescription,
  type SuggestionForm,
} from '../tasks/taskFormFields';
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
} from '../tasks/taskLabels';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { KIND_ICON, KIND_LABEL, KIND_ORDER, transplantDescriptionFor } from './recordLabels';
import { useGardenCache } from './useGardenCache';

const NOTES_MAX = 500;

interface GardenRecordFormDialogProps {
  /** Sin `activity`: alta. Con `activity`: edición (solo se envía lo que cambió, con su versión). */
  activity?: GardenActivity;
  /** Participantes activos: los únicos responsables posibles. */
  participants: TaskEmployee[];
  onCancel: () => void;
  onCreated: (result: CreateGardenActivityResponse) => void;
  onUpdated: (activity: GardenActivity) => void;
  onSessionExpired: () => void;
}

/**
 * 🥬 Huerta → 📝 Registros: «Nuevo registro» y «Editar registro». Tipo,
 * descripción, responsable, frecuencia («Una vez» por defecto), fecha
 * prevista (solo «Una vez») y observaciones; orden y programación sugerida
 * en «Opciones avanzadas» (abiertas si ya tienen valores). Al crear una
 * siembra «Una vez», «Programar también el trasplante» crea otro registro
 * independiente en la misma operación. Un envío a la vez y
 * `Idempotency-Key` estable por intento: un doble clic no duplica. El
 * borrador se conserva ante cualquier falla.
 */
export function GardenRecordFormDialog({
  activity,
  participants,
  onCancel,
  onCreated,
  onUpdated,
  onSessionExpired,
}: GardenRecordFormDialogProps) {
  const formId = useId();
  const field = (key: string) => `${formId}-${key}`;
  const isEdit = activity !== undefined;
  const [opened] = useState(activity);
  const { afterActivityChange } = useGardenCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());

  const [kind, setKind] = useState<GardenActivityKind | ''>(opened?.kind ?? '');
  const [description, setDescription] = useState(opened?.description ?? '');
  const [participantId, setParticipantId] = useState(opened?.responsible.id ?? '');
  const [frequency, setFrequency] = useState<TaskFrequency>(opened?.frequency ?? 'ONE_TIME');
  // Se conserva si se elige otra frecuencia y se vuelve a «Una vez» antes de guardar.
  const [scheduledDate, setScheduledDate] = useState(opened?.scheduledDate ?? '');
  const [notes, setNotes] = useState(opened?.notes ?? '');
  const [executionOrder, setExecutionOrder] = useState(
    opened?.executionOrder != null ? String(opened.executionOrder) : '',
  );
  const [suggestion, setSuggestion] = useState<SuggestionForm>(() => suggestionFormOf(opened));
  const [withTransplant, setWithTransplant] = useState(false);
  const [transplantDescription, setTransplantDescription] = useState('');
  const [transplantParticipantId, setTransplantParticipantId] = useState('');
  const [transplantDate, setTransplantDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const oneTime = frequency === 'ONE_TIME';
  const hint = FREQUENCY_HINT[frequency];
  const suggestionInputs = SUGGESTION_INPUTS[frequency];
  const hasAdvancedValues =
    opened !== undefined &&
    (opened.executionOrder !== null || SUGGESTION_FIELDS.some((key) => opened[key] !== null));
  const suggestionDropped =
    opened !== undefined &&
    frequency !== opened.frequency &&
    SUGGESTION_FIELDS.some((key) => opened[key] !== null && suggestion[key] === '');
  const canScheduleTransplant = !isEdit && kind === 'SOWING' && oneTime;
  const transplantOn = canScheduleTransplant && withTransplant;

  // Un responsable que ya no participa sigue como opción actual (no se «pierde» en el select).
  const options =
    opened && !participants.some((person) => person.id === opened.responsible.id)
      ? [...participants, { ...opened.responsible, colorHex: opened.responsible.colorHex ?? '' }]
      : participants;

  const change = (apply: () => void) => {
    apply();
    setError(null);
  };

  function toggleTransplant(checked: boolean): void {
    change(() => {
      setWithTransplant(checked);
      // Valores iniciales editables: el mismo responsable y «Trasplantar …».
      if (checked && !transplantDescription) {
        setTransplantDescription(transplantDescriptionFor(description));
      }
      if (checked && !transplantParticipantId) setTransplantParticipantId(participantId);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isEdit && !kind) return setError('Elegí el tipo: siembra, trasplante u otra actividad.');
    const normalized = normalizeDescription(description);
    const problem = validateDescription(normalized);
    if (problem) return setError(problem);
    if (!participantId) return setError('Elegí un responsable.');
    const order = parseExecutionOrder(executionOrder);
    if (order === undefined) return setError(ORDER_ERROR);
    // Solo la sugerencia que admite la frecuencia elegida.
    const suggested = Object.fromEntries(
      suggestionInputs.map((input) => [
        input.field,
        suggestion[input.field] === '' ? null : Number(suggestion[input.field]),
      ]),
    ) as Partial<Record<TaskSuggestionField, number | null>>;
    if (
      PAIRED_SUGGESTION.has(frequency) &&
      (suggested.suggestedMonth === null) !== (suggested.suggestedMonthDay === null)
    ) {
      return setError(SUGGESTION_PAIR_ERROR);
    }
    const date = oneTime ? scheduledDate || null : null;
    const cleanNotes = normalizeDescription(notes) || null;
    if (cleanNotes && /[<>]/.test(cleanNotes)) {
      return setError('Las observaciones no pueden contener HTML.');
    }

    if (!opened) {
      let transplant: CreateGardenActivityRequest['transplant'];
      if (transplantOn) {
        const transplantText = normalizeDescription(transplantDescription);
        const transplantProblem = validateDescription(transplantText);
        if (transplantProblem) return setError(`Trasplante: ${transplantProblem}`);
        if (!transplantParticipantId) return setError('Elegí el responsable del trasplante.');
        if (date && transplantDate && transplantDate < date) {
          return setError(
            'La fecha prevista del trasplante no puede ser anterior a la de la siembra.',
          );
        }
        transplant = {
          description: transplantText,
          participantId: transplantParticipantId,
          ...(transplantDate ? { scheduledDate: transplantDate } : {}),
        };
      }
      const body: CreateGardenActivityRequest = {
        kind: kind as GardenActivityKind,
        description: normalized,
        participantId,
        frequency,
        ...(date ? { scheduledDate: date } : {}),
        ...(cleanNotes ? { notes: cleanNotes } : {}),
        ...(order !== null ? { executionOrder: order } : {}),
        ...Object.fromEntries(Object.entries(suggested).filter(([, value]) => value !== null)),
        ...(transplant ? { transplant } : {}),
      };
      const key = intent.current.keyFor(intentFingerprint('kitchen-garden-activity', body));
      submit(async () => {
        const result = await createGardenActivity(body, key);
        intent.current.discard();
        afterActivityChange();
        onCreated(result);
      });
      return;
    }

    const changes: UpdateGardenActivityRequest = { version: opened.version };
    if (kind && kind !== opened.kind) changes.kind = kind;
    if (normalized !== opened.description) changes.description = normalized;
    if (participantId !== opened.responsible.id) changes.participantId = participantId;
    if (frequency !== opened.frequency) changes.frequency = frequency;
    // `null` quita la fecha; omitida la deja como está (al dejar «Una vez», la quita el backend).
    if (oneTime && date !== opened.scheduledDate) changes.scheduledDate = date;
    if (cleanNotes !== opened.notes) changes.notes = cleanNotes;
    if (order !== opened.executionOrder) changes.executionOrder = order;
    for (const [key, value] of Object.entries(suggested) as [
      TaskSuggestionField,
      number | null,
    ][]) {
      if (value !== opened[key]) changes[key] = value;
    }
    if (Object.keys(changes).length === 1) {
      onCancel();
      return;
    }
    submit(async () => {
      const result = await updateGardenActivity(opened.id, changes);
      afterActivityChange();
      onUpdated(result.activity);
    });
  }

  /** Sesión vencida → login; 409 → refresca lo de atrás sin cerrar; borrador intacto. */
  function submit(action: () => Promise<void>): void {
    void run(async () => {
      setError(null);
      try {
        await action();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        const retryable =
          caught instanceof OfflineError || !(caught instanceof ApiError) || caught.status >= 500;
        if (!retryable) intent.current.discard();
        if (caught instanceof ApiError && caught.status === 409) afterActivityChange();
        setError(errorMessageOf(caught));
      }
    });
  }

  const close = () => {
    if (!isSubmitting) onCancel();
  };

  return (
    <Modal titleId={field('title')} onRequestClose={close} closeDisabled={isSubmitting}>
      <form
        className="dialog dialog--prototype garden-record-form"
        onSubmit={handleSubmit}
        noValidate
      >
        <h2 id={field('title')} className="dialog__title">
          {isEdit ? 'Editar registro' : 'Nuevo registro'}
        </h2>
        <fieldset className="garden-record-form__group" disabled={isSubmitting}>
          <div className="field">
            <label className="field__label" htmlFor={field('kind')}>
              Tipo
            </label>
            <select
              id={field('kind')}
              className="field__input"
              value={kind}
              aria-describedby={opened && opened.kind === null ? field('kind-hint') : undefined}
              onChange={(event) =>
                change(() => setKind(event.target.value as GardenActivityKind | ''))
              }
            >
              <option value="" disabled={!isEdit || opened?.kind !== null}>
                {isEdit ? 'Sin clasificar' : 'Elegí el tipo'}
              </option>
              {KIND_ORDER.map((value) => (
                <option key={value} value={value}>
                  {KIND_ICON[value]} {KIND_LABEL[value]}
                </option>
              ))}
            </select>
            {opened && opened.kind === null ? (
              <p className="field__hint" id={field('kind-hint')}>
                Este registro es anterior a los tipos. Clasificarlo es opcional.
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field__label" htmlFor={field('description')}>
              Descripción
            </label>
            <input
              id={field('description')}
              className="field__input"
              type="text"
              maxLength={DESCRIPTION_MAX}
              autoComplete="off"
              value={description}
              onChange={(event) => change(() => setDescription(event.target.value))}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={field('responsible')}>
              Responsable
            </label>
            <select
              id={field('responsible')}
              className="field__input"
              value={participantId}
              onChange={(event) => change(() => setParticipantId(event.target.value))}
            >
              <option value="">Elegí una persona</option>
              {options.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={field('frequency')}>
              Frecuencia
            </label>
            <select
              id={field('frequency')}
              className="field__input"
              value={frequency}
              aria-describedby={hint ? field('frequency-hint') : undefined}
              onChange={(event) => {
                const next = event.target.value as TaskFrequency;
                change(() => {
                  setFrequency(next);
                  setSuggestion((current) => keepValidSuggestion(current, next));
                });
              }}
            >
              {FREQUENCY_ORDER.map((value) => (
                <option key={value} value={value}>
                  {FREQUENCY_LABEL[value]}
                </option>
              ))}
            </select>
            {hint ? (
              <p className="field__hint" id={field('frequency-hint')}>
                {hint}
              </p>
            ) : null}
            {suggestionDropped ? (
              <p className="field__hint" role="status">
                {SUGGESTION_DROPPED_NOTICE}
              </p>
            ) : null}
          </div>

          {oneTime ? (
            <div className="field">
              <label className="field__label" htmlFor={field('date')}>
                Fecha prevista (opcional)
              </label>
              <input
                id={field('date')}
                className="field__input"
                type="date"
                min="2000-01-01"
                max="2100-12-31"
                value={scheduledDate}
                aria-describedby={field('date-hint')}
                onChange={(event) => change(() => setScheduledDate(event.target.value))}
              />
              <p className="field__hint" id={field('date-hint')}>
                {scheduledDate
                  ? formatDateWithWeekday(scheduledDate)
                  : 'Sin fecha queda en «Sin fecha». Puede ser pasada si ya está atrasada.'}
              </p>
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor={field('notes')}>
              Observaciones (opcional)
            </label>
            <input
              id={field('notes')}
              className="field__input"
              type="text"
              maxLength={NOTES_MAX}
              autoComplete="off"
              value={notes}
              onChange={(event) => change(() => setNotes(event.target.value))}
            />
          </div>

          {canScheduleTransplant ? (
            <div className="garden-transplant">
              <label className="choice">
                <input
                  type="checkbox"
                  checked={withTransplant}
                  aria-describedby={field('transplant-hint')}
                  onChange={(event) => toggleTransplant(event.target.checked)}
                />
                <span>
                  <span aria-hidden="true">🪴 </span>Programar también el trasplante
                </span>
              </label>
              <p className="field__hint" id={field('transplant-hint')}>
                Se crean dos registros independientes: completar la siembra no completa el
                trasplante y después se editan por separado.
              </p>
              {withTransplant ? (
                <>
                  <div className="field">
                    <label className="field__label" htmlFor={field('t-description')}>
                      Descripción del trasplante
                    </label>
                    <input
                      id={field('t-description')}
                      className="field__input"
                      type="text"
                      maxLength={DESCRIPTION_MAX}
                      autoComplete="off"
                      value={transplantDescription}
                      onChange={(event) =>
                        change(() => setTransplantDescription(event.target.value))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={field('t-date')}>
                      Fecha prevista del trasplante (opcional)
                    </label>
                    <input
                      id={field('t-date')}
                      className="field__input"
                      type="date"
                      min={scheduledDate || '2000-01-01'}
                      max="2100-12-31"
                      value={transplantDate}
                      onChange={(event) => change(() => setTransplantDate(event.target.value))}
                    />
                  </div>
                  <div className="field">
                    <label className="field__label" htmlFor={field('t-responsible')}>
                      Responsable del trasplante
                    </label>
                    <select
                      id={field('t-responsible')}
                      className="field__input"
                      value={transplantParticipantId}
                      onChange={(event) =>
                        change(() => setTransplantParticipantId(event.target.value))
                      }
                    >
                      <option value="">Elegí una persona</option>
                      {participants.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <details className="garden-advanced" open={hasAdvancedValues || undefined}>
            <summary>Opciones avanzadas</summary>
            {suggestionInputs.length > 0 ? (
              <div className="field">
                <div className={suggestionInputs.length > 1 ? 'field-row' : undefined}>
                  {suggestionInputs.map((input) => (
                    <div className="field" key={input.field}>
                      <label className="field__label" htmlFor={field(input.field)}>
                        {input.label}
                      </label>
                      <select
                        id={field(input.field)}
                        className="field__input"
                        value={suggestion[input.field]}
                        aria-describedby={field('suggestion-hint')}
                        onChange={(event) => {
                          const value = event.target.value;
                          change(() =>
                            setSuggestion((current) => ({ ...current, [input.field]: value })),
                          );
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
                <p className="field__hint" id={field('suggestion-hint')}>
                  {frequency === 'WEEKLY'
                    ? SUGGESTION_HINT
                    : `${SUGGESTION_HINT} ${SUGGESTION_LAST_DAY_HINT}`}
                </p>
              </div>
            ) : null}
            <div className="field">
              <label className="field__label" htmlFor={field('order')}>
                Orden de realización
              </label>
              <input
                id={field('order')}
                className="field__input"
                type="number"
                inputMode="numeric"
                min={1}
                max={EXECUTION_ORDER_MAX}
                step={1}
                value={executionOrder}
                aria-describedby={field('order-hint')}
                onChange={(event) => change(() => setExecutionOrder(event.target.value))}
              />
              <p className="field__hint" id={field('order-hint')}>
                {EXECUTION_ORDER_HINT}
              </p>
            </div>
          </details>
        </fieldset>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
        </div>

        <div className="dialog__actions">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit
              ? 'Guardar cambios'
              : transplantOn
                ? 'Crear siembra y trasplante'
                : 'Crear registro'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
