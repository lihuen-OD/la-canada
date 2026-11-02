import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createGardenTransplant } from '../../api/kitchenGardenApi';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import type {
  CreateGardenTransplantRequest,
  GardenBatchDetail,
  GardenCropViewer,
  GardenParticipant,
} from '../../api/kitchenGardenTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatDate } from '../../utils/dateFormat';
import { DialogStatus, PersonSelect, useCropSubmit } from './CropFields';
import { WHOLE_SEEDLINGS, normalizeQuantity, quantityError } from './cropLabels';
import { useGardenCache } from './useGardenCache';

interface TransplantDialogProps {
  batch: GardenBatchDetail;
  today: string;
  viewer: GardenCropViewer;
  participants: GardenParticipant[];
  onClose: () => void;
  onSaved: (batch: GardenBatchDetail) => void;
  onSessionExpired: () => void;
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * «Registrar trasplante» desde la ficha (también sin haberlo programado).
 * Fecha real hoy o pasada, nunca anterior a la siembra; varios parciales. Si
 * la tanda tiene trasplantes pendientes, quien registra decide de forma
 * EXPLÍCITA si quedan (conservando o cambiando la fecha prevista) o confirma
 * «No quedan trasplantes pendientes»: un trasplante no los cierra solo y una
 * fecha prevista nunca se convierte en un hecho. Idempotente por intento.
 */
export function TransplantDialog({
  batch,
  today,
  viewer,
  participants,
  onClose,
  onSaved,
  onSessionExpired,
}: TransplantDialogProps) {
  const formId = useId();
  const intent = useRef(new IdempotencyIntent());
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  /** La tanda tal como estaba al abrir: su versión protege lo previsto. */
  const [opened] = useState(batch);
  const sowingDate = opened.sowing?.performedOn ?? '';
  const plan = opened.transplantPlan;
  const [performedOn, setPerformedOn] = useState(today);
  const [person, setPerson] = useState(viewer.participantId ?? '');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [remaining, setRemaining] = useState(true);
  const [expected, setExpected] = useState(plan.expectedDate ?? '');

  const field = (name: string) => `${formId}-${name}`;
  const change = (apply: () => void) => {
    apply();
    setError(null);
  };

  function validate(): string | CreateGardenTransplantRequest {
    if (!performedOn) return 'Indicá la fecha del trasplante.';
    if (performedOn > today) return 'La fecha no puede ser futura.';
    if (sowingDate && performedOn < sowingDate) {
      return `El trasplante no puede ser anterior a la siembra (${formatDate(sowingDate)}).`;
    }
    if (!person) return 'Elegí quién trasplantó.';
    if (!clean(location)) return 'Indicá el lugar de destino.';
    const quantityProblem = quantityError(quantity, WHOLE_SEEDLINGS);
    if (quantityProblem) return quantityProblem;
    const remainingPending = plan.pending ? remaining : false;
    if (remainingPending && expected && sowingDate && expected < sowingDate) {
      return 'La fecha prevista no puede ser anterior a la siembra.';
    }
    const body: CreateGardenTransplantRequest = {
      batchVersion: opened.version,
      performedOn,
      performedByParticipantId: person,
      location: clean(location),
      remainingPending,
    };
    if (quantity.trim()) body.quantity = normalizeQuantity(quantity);
    if (clean(notes)) body.notes = clean(notes);
    if (remainingPending && expected !== (plan.expectedDate ?? '')) {
      body.expectedTransplantDate = expected || null;
    }
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = validate();
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    const key = intent.current.keyFor(intentFingerprint(`transplant:${opened.id}`, body));
    void submit(
      async () => {
        const result = await createGardenTransplant(opened.id, body, key);
        intent.current.discard();
        afterCropChange();
        onSaved(result.batch);
      },
      (retryable) => {
        if (!retryable) intent.current.discard();
      },
    );
  }

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal titleId={field('title')} onRequestClose={close} closeDisabled={isSubmitting}>
      <form className="dialog dialog--prototype crop-form" onSubmit={handleSubmit} noValidate>
        <h2 id={field('title')} className="dialog__title">
          <span aria-hidden="true">🪴 </span>Registrar trasplante
        </h2>
        <p className="field__hint">
          {opened.crop.name} · {opened.name}
          {sowingDate ? ` · sembrada el ${formatDate(sowingDate)}` : ''}
        </p>
        <fieldset className="crop-form__group" disabled={isSubmitting}>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('date')}>
                Fecha del trasplante
              </label>
              <input
                id={field('date')}
                className="field__input"
                type="date"
                min={sowingDate || undefined}
                max={today}
                value={performedOn}
                onChange={(event) => change(() => setPerformedOn(event.target.value))}
              />
            </div>
            <PersonSelect
              id={field('person')}
              label="¿Quién trasplantó?"
              value={person}
              participants={participants}
              onChange={(value) => change(() => setPerson(value))}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={field('location')}>
              Lugar de destino
            </label>
            <input
              id={field('location')}
              className="field__input"
              maxLength={120}
              autoComplete="off"
              placeholder="Ej: Cantero 4"
              value={location}
              onChange={(event) => change(() => setLocation(event.target.value))}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('quantity')}>
                Plantines (opcional)
              </label>
              <input
                id={field('quantity')}
                className="field__input"
                inputMode="numeric"
                autoComplete="off"
                value={quantity}
                onChange={(event) => change(() => setQuantity(event.target.value))}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={field('notes')}>
                Observaciones (opcional)
              </label>
              <input
                id={field('notes')}
                className="field__input"
                maxLength={500}
                autoComplete="off"
                value={notes}
                onChange={(event) => change(() => setNotes(event.target.value))}
              />
            </div>
          </div>
          {plan.pending ? (
            <fieldset className="choice-list crop-form__choices">
              <legend className="field__label">¿Quedan trasplantes pendientes?</legend>
              <label className="choice">
                <input
                  type="radio"
                  name={field('remaining')}
                  checked={remaining}
                  onChange={() => change(() => setRemaining(true))}
                />
                <span>Sí, quedan pendientes</span>
                <span className="choice__hint">Por ejemplo, si fue un trasplante parcial</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name={field('remaining')}
                  checked={!remaining}
                  onChange={() => change(() => setRemaining(false))}
                />
                <span>No quedan trasplantes pendientes</span>
              </label>
            </fieldset>
          ) : null}
          {plan.pending && remaining ? (
            <div className="field">
              <label className="field__label" htmlFor={field('expected')}>
                Fecha prevista del próximo trasplante (opcional)
              </label>
              <input
                id={field('expected')}
                className="field__input"
                type="date"
                min={sowingDate || undefined}
                value={expected}
                aria-describedby={field('expected-hint')}
                onChange={(event) => change(() => setExpected(event.target.value))}
              />
              <p className="field__hint" id={field('expected-hint')}>
                {plan.expectedDate
                  ? `Prevista: ${formatDate(plan.expectedDate)}. Conservala, cambiala o borrala.`
                  : 'Sin fecha prevista. Podés indicar una.'}
              </p>
            </div>
          ) : null}
        </fieldset>
        <DialogStatus busy={isSubmitting} busyLabel="Guardando…" error={error} />
        <div className="dialog__actions">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Registrar trasplante
          </Button>
        </div>
      </form>
    </Modal>
  );
}
