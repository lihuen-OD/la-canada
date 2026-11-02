import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { updateGardenCropRecord } from '../../api/kitchenGardenApi';
import type {
  GardenBatchDetail,
  GardenCropRecord,
  GardenParticipant,
  GardenSowingMethod,
  UpdateGardenCropRecordRequest,
} from '../../api/kitchenGardenTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatDate } from '../../utils/dateFormat';
import { DialogStatus, PersonSelect, useCropSubmit } from './CropFields';
import {
  METHOD_LABEL,
  RECORD_TYPE_LABEL,
  SOWING_UNIT_OPTIONS,
  WHOLE_SEEDLINGS,
  WHOLE_SEEDS,
  normalizeQuantity,
  quantityError,
} from './cropLabels';
import { useGardenCache } from './useGardenCache';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
/** `12.50` y `12,5` son la misma cantidad. */
const sameQuantity = (a: string, b: string) =>
  a === b || (a !== '' && b !== '' && Number(normalizeQuantity(a)) === Number(b));

interface RecordEditDialogProps {
  batch: GardenBatchDetail;
  record: GardenCropRecord;
  today: string;
  participants: GardenParticipant[];
  onClose: () => void;
  onSaved: (batch: GardenBatchDetail) => void;
  onSessionExpired: () => void;
}

/**
 * Corregir una siembra o un trasplante (ADMIN o participante activo, también
 * lo de otra persona): fecha, quién lo hizo, lugar, cantidad y observaciones
 * (y la modalidad, solo en la siembra). Conserva quién lo registró. Envía
 * solo lo que cambió con la versión que se abrió; sin cambios, cierra sin
 * enviar nada. Las fechas las valida también el backend contra la siembra
 * y los trasplantes vigentes.
 */
export function RecordEditDialog({
  batch,
  record,
  today,
  participants,
  onClose,
  onSaved,
  onSessionExpired,
}: RecordEditDialogProps) {
  const formId = useId();
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  const [opened] = useState(record);
  const sowing = opened.type === 'SOWING';
  const sowingDate = batch.sowing?.performedOn ?? '';
  const firstTransplant = batch.transplants[0]?.performedOn ?? '';
  const [performedOn, setPerformedOn] = useState(opened.performedOn);
  const [person, setPerson] = useState(opened.performedBy.id);
  const [location, setLocation] = useState(opened.location);
  const [method, setMethod] = useState<GardenSowingMethod | null>(opened.method);
  const [quantity, setQuantity] = useState(opened.quantity?.replace('.', ',') ?? '');
  const [unit, setUnit] = useState<'SEEDS' | 'GRAMS' | ''>(
    opened.quantityUnit === 'SEEDS' || opened.quantityUnit === 'GRAMS' ? opened.quantityUnit : '',
  );
  const [notes, setNotes] = useState(opened.notes ?? '');
  const field = (key: string) => `${formId}-${key}`;
  const change = (apply: () => void) => {
    apply();
    setError(null);
  };

  function validate(): string | UpdateGardenCropRecordRequest {
    if (!performedOn) return 'Indicá la fecha.';
    if (performedOn > today) return 'La fecha no puede ser futura.';
    if (sowing && firstTransplant && performedOn > firstTransplant) {
      return `La siembra no puede quedar después de un trasplante (${formatDate(firstTransplant)}).`;
    }
    if (!sowing && sowingDate && performedOn < sowingDate) {
      return `El trasplante no puede ser anterior a la siembra (${formatDate(sowingDate)}).`;
    }
    if (!clean(location)) return 'Indicá el lugar.';
    const quantityProblem = quantityError(
      quantity,
      sowing ? (unit === 'SEEDS' ? WHOLE_SEEDS : null) : WHOLE_SEEDLINGS,
    );
    if (quantityProblem) return quantityProblem;
    if (sowing && quantity.trim() && !unit) return 'Elegí la unidad de la cantidad.';
    if (sowing && !quantity.trim() && unit) return 'Indicá la cantidad o quitá la unidad.';

    const body: UpdateGardenCropRecordRequest = { version: opened.version };
    if (performedOn !== opened.performedOn) body.performedOn = performedOn;
    if (person !== opened.performedBy.id) body.performedByParticipantId = person;
    if (clean(location) !== opened.location) body.location = clean(location);
    if (sowing && method && method !== opened.method) body.method = method;
    if (!sameQuantity(quantity.trim(), opened.quantity ?? '')) {
      body.quantity = quantity.trim() ? normalizeQuantity(quantity) : null;
    }
    if (sowing && (unit || null) !== (opened.quantityUnit ?? null)) {
      body.quantityUnit = unit || null;
    }
    if (clean(notes) !== (opened.notes ?? '')) body.notes = clean(notes) || null;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = validate();
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void submit(async () => {
      const result = await updateGardenCropRecord(opened.id, body);
      afterCropChange();
      onSaved(result.batch);
    });
  }

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal titleId={field('title')} onRequestClose={close} closeDisabled={isSubmitting}>
      <form className="dialog dialog--prototype crop-form" onSubmit={handleSubmit} noValidate>
        <h2 id={field('title')} className="dialog__title">
          Corregir {RECORD_TYPE_LABEL[opened.type].toLowerCase()}
        </h2>
        <p className="field__hint">Registrado por {opened.recordedBy.displayName}: no cambia.</p>
        <fieldset className="crop-form__group" disabled={isSubmitting}>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('date')}>
                Fecha
              </label>
              <input
                id={field('date')}
                className="field__input"
                type="date"
                min={!sowing && sowingDate ? sowingDate : undefined}
                max={sowing && firstTransplant && firstTransplant < today ? firstTransplant : today}
                value={performedOn}
                onChange={(event) => change(() => setPerformedOn(event.target.value))}
              />
            </div>
            <PersonSelect
              id={field('person')}
              label="¿Quién lo hizo?"
              value={person}
              participants={participants}
              current={opened.performedBy}
              onChange={(value) => change(() => setPerson(value))}
            />
          </div>
          {sowing ? (
            <fieldset className="choice-list crop-form__choices">
              <legend className="field__label">Modalidad</legend>
              {(['DIRECT', 'SEEDBED'] as const).map((option) => (
                <label key={option} className="choice">
                  <input
                    type="radio"
                    name={field('method')}
                    checked={method === option}
                    onChange={() => change(() => setMethod(option))}
                  />
                  <span>{METHOD_LABEL[option]}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="field">
            <label className="field__label" htmlFor={field('location')}>
              {sowing ? 'Lugar' : 'Lugar de destino'}
            </label>
            <input
              id={field('location')}
              className="field__input"
              maxLength={120}
              autoComplete="off"
              value={location}
              onChange={(event) => change(() => setLocation(event.target.value))}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('quantity')}>
                {sowing ? 'Cantidad (opcional)' : 'Plantines (opcional)'}
              </label>
              <input
                id={field('quantity')}
                className="field__input"
                inputMode="decimal"
                autoComplete="off"
                value={quantity}
                onChange={(event) => change(() => setQuantity(event.target.value))}
              />
            </div>
            {sowing ? (
              <div className="field">
                <label className="field__label" htmlFor={field('unit')}>
                  Unidad
                </label>
                <select
                  id={field('unit')}
                  className="field__input"
                  value={unit}
                  onChange={(event) =>
                    change(() => setUnit(event.target.value as 'SEEDS' | 'GRAMS' | ''))
                  }
                >
                  <option value="">Sin cantidad</option>
                  {SOWING_UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
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
        </fieldset>
        <DialogStatus busy={isSubmitting} busyLabel="Guardando…" error={error} />
        <div className="dialog__actions">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
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
