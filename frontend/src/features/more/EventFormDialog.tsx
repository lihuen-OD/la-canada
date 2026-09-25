import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { createEvent, updateEvent } from '../../api/moreApi';
import type { CalendarEvent, EventType } from '../../api/moreTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { EVENT_ICON, EVENT_LABEL, normalizeText } from './moreLabels';

const TYPES: readonly EventType[] = ['VISIT', 'BIRTHDAY', 'MAINTENANCE', 'OTHER'];

interface EventFormDialogProps {
  /** Sin `event` = "Nuevo evento". */
  event?: CalendarEvent;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}

/** "Nuevo evento" / "Editar evento" (solo ADMIN): título, fecha, tipo y nota opcional. */
export function EventFormDialog({
  event,
  onClose,
  onSaved,
  onSessionExpired,
}: EventFormDialogProps) {
  const formId = useId();
  const { isSubmitting, run } = useSubmitGuard();
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.date ?? '');
  const [type, setType] = useState<EventType>(event?.type ?? 'VISIT');
  const [note, setNote] = useState(event?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(submit: FormEvent<HTMLFormElement>): void {
    submit.preventDefault();
    const cleanTitle = normalizeText(title);
    if (!cleanTitle || !date) {
      setError('Completá título y fecha.');
      return;
    }
    const body = { title: cleanTitle, date, type, note: normalizeText(note) || null };
    void run(async () => {
      setError(null);
      try {
        if (event) await updateEvent(event.id, body);
        else await createEvent(body);
        onSaved();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          {event ? 'Editar evento' : 'Nuevo evento'}
        </h2>
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-title-input`}>
            Título
          </label>
          <input
            id={`${formId}-title-input`}
            className="field__input"
            maxLength={120}
            autoComplete="off"
            placeholder="Ej: Visita familia González"
            value={title}
            disabled={isSubmitting}
            onChange={(change) => setTitle(change.target.value)}
          />
        </div>
        <div className="more-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-date`}>
              Fecha
            </label>
            <input
              id={`${formId}-date`}
              className="field__input"
              type="date"
              min="1900-01-01"
              max="2100-12-31"
              value={date}
              disabled={isSubmitting}
              onChange={(change) => setDate(change.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-type`}>
              Tipo
            </label>
            <select
              id={`${formId}-type`}
              className="field__input"
              value={type}
              disabled={isSubmitting}
              onChange={(change) => setType(change.target.value as EventType)}
            >
              {TYPES.map((option) => (
                <option key={option} value={option}>
                  {EVENT_ICON[option]} {EVENT_LABEL[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-note`}>
            Nota (opcional)
          </label>
          <textarea
            id={`${formId}-note`}
            className="field__input field__input--textarea"
            rows={2}
            maxLength={300}
            placeholder="Detalles..."
            value={note}
            disabled={isSubmitting}
            onChange={(change) => setNote(change.target.value)}
          />
        </div>
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
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
