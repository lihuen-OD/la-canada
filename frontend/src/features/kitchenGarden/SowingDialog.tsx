import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createGardenSowing } from '../../api/kitchenGardenApi';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import type {
  CreateGardenSowingRequest,
  GardenBatchDetail,
  GardenCrop,
  GardenCropViewer,
  GardenParticipant,
  GardenSowingMethod,
} from '../../api/kitchenGardenTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { DialogStatus, PersonSelect, useCropSubmit } from './CropFields';
import {
  METHOD_LABEL,
  SOWING_UNIT_OPTIONS,
  WHOLE_SEEDS,
  normalizeQuantity,
  quantityError,
} from './cropLabels';
import { useGardenCache } from './useGardenCache';

interface SowingDialogProps {
  today: string;
  viewer: GardenCropViewer;
  participants: GardenParticipant[];
  crops: GardenCrop[];
  onClose: () => void;
  onCreated: (batch: GardenBatchDetail) => void;
  onSessionExpired: () => void;
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * «Registrar siembra»: la tanda (cultivo, nombre, variedad, observaciones) y
 * su siembra en UNA operación. Fecha real hoy o pasada; persona
 * preseleccionada (la propia participación de un empleado) y cambiable de
 * forma explícita; directa o almácigo (este último con fecha prevista de
 * trasplante opcional); cantidad opcional siempre con su unidad.
 * `Idempotency-Key` estable por intento: un doble envío o un reintento tras
 * una falla de red no crean dos tandas. Ante cualquier error, el borrador queda.
 */
export function SowingDialog({
  today,
  viewer,
  participants,
  crops,
  onClose,
  onCreated,
  onSessionExpired,
}: SowingDialogProps) {
  const formId = useId();
  const intent = useRef(new IdempotencyIntent());
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  const [cropName, setCropName] = useState('');
  const [batchName, setBatchName] = useState('');
  const [variety, setVariety] = useState('');
  const [batchNotes, setBatchNotes] = useState('');
  const [performedOn, setPerformedOn] = useState(today);
  const [person, setPerson] = useState(viewer.participantId ?? '');
  const [method, setMethod] = useState<GardenSowingMethod | ''>('');
  const [location, setLocation] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<'SEEDS' | 'GRAMS' | ''>('');
  const [notes, setNotes] = useState('');
  const [expected, setExpected] = useState('');

  const field = (name: string) => `${formId}-${name}`;
  const change = (apply: () => void) => {
    apply();
    setError(null);
  };

  function validate(): string | CreateGardenSowingRequest {
    if (!clean(cropName)) return 'Indicá el cultivo.';
    if (!clean(batchName)) return 'Indicá el nombre de la tanda.';
    if (!performedOn) return 'Indicá la fecha de siembra.';
    if (performedOn > today) return 'La fecha no puede ser futura.';
    if (!person) return 'Elegí quién sembró.';
    if (!method) return 'Elegí la modalidad: directa o almácigo.';
    if (!clean(location)) return 'Indicá el lugar.';
    const quantityProblem = quantityError(quantity, unit === 'SEEDS' ? WHOLE_SEEDS : null);
    if (quantityProblem) return quantityProblem;
    if (quantity.trim() && !unit) return 'Elegí la unidad de la cantidad (semillas o gramos).';
    if (!quantity.trim() && unit) return 'Indicá la cantidad o quitá la unidad.';
    if (method === 'SEEDBED' && expected && expected < performedOn) {
      return 'La fecha prevista de trasplante no puede ser anterior a la siembra.';
    }
    const body: CreateGardenSowingRequest = {
      cropName: clean(cropName),
      batchName: clean(batchName),
      performedOn,
      performedByParticipantId: person,
      method,
      location: clean(location),
    };
    if (clean(variety)) body.variety = clean(variety);
    if (clean(batchNotes)) body.batchNotes = clean(batchNotes);
    if (clean(notes)) body.notes = clean(notes);
    if (quantity.trim() && unit) {
      body.quantity = normalizeQuantity(quantity);
      body.quantityUnit = unit;
    }
    if (method === 'SEEDBED' && expected) body.expectedTransplantDate = expected;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const body = validate();
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    const key = intent.current.keyFor(intentFingerprint('sowing', body));
    void submit(
      async () => {
        const { batch } = await createGardenSowing(body, key);
        intent.current.discard();
        afterCropChange();
        onCreated(batch);
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
          <span aria-hidden="true">🌱 </span>Registrar siembra
        </h2>
        <p className="field__hint">Cada siembra es una tanda nueva, aunque el cultivo se repita.</p>
        <fieldset className="crop-form__group" disabled={isSubmitting}>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('crop')}>
                Cultivo
              </label>
              <input
                id={field('crop')}
                className="field__input"
                list={field('crops')}
                maxLength={60}
                autoComplete="off"
                placeholder="Ej: Lechuga"
                value={cropName}
                onChange={(event) => change(() => setCropName(event.target.value))}
              />
              <datalist id={field('crops')}>
                {crops.map((crop) => (
                  <option key={crop.id} value={crop.name} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={field('variety')}>
                Variedad (opcional)
              </label>
              <input
                id={field('variety')}
                className="field__input"
                maxLength={80}
                autoComplete="off"
                value={variety}
                onChange={(event) => change(() => setVariety(event.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={field('batch')}>
              Nombre de la tanda
            </label>
            <input
              id={field('batch')}
              className="field__input"
              maxLength={80}
              autoComplete="off"
              placeholder="Ej: Primavera, cantero norte"
              value={batchName}
              onChange={(event) => change(() => setBatchName(event.target.value))}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('date')}>
                Fecha de siembra
              </label>
              <input
                id={field('date')}
                className="field__input"
                type="date"
                max={today}
                value={performedOn}
                onChange={(event) => change(() => setPerformedOn(event.target.value))}
              />
            </div>
            <PersonSelect
              id={field('person')}
              label="¿Quién sembró?"
              value={person}
              participants={participants}
              onChange={(value) => change(() => setPerson(value))}
            />
          </div>
          <fieldset className="choice-list crop-form__choices">
            <legend className="field__label">Modalidad</legend>
            {(['DIRECT', 'SEEDBED'] as const).map((option) => (
              <label key={option} className="choice">
                <input
                  type="radio"
                  name={field('method')}
                  value={option}
                  checked={method === option}
                  onChange={() => change(() => setMethod(option))}
                />
                <span>{METHOD_LABEL[option]}</span>
                <span className="choice__hint">
                  {option === 'DIRECT' ? 'No requiere trasplante' : 'Queda un trasplante pendiente'}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor={field('location')}>
              Lugar
            </label>
            <input
              id={field('location')}
              className="field__input"
              maxLength={120}
              autoComplete="off"
              placeholder="Ej: Cantero 3, almácigo del invernadero"
              value={location}
              onChange={(event) => change(() => setLocation(event.target.value))}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor={field('quantity')}>
                Cantidad (opcional)
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
          </div>
          {method === 'SEEDBED' ? (
            <div className="field">
              <label className="field__label" htmlFor={field('expected')}>
                Fecha prevista de trasplante (opcional)
              </label>
              <input
                id={field('expected')}
                className="field__input"
                type="date"
                min={performedOn || undefined}
                value={expected}
                aria-describedby={field('expected-hint')}
                onChange={(event) => change(() => setExpected(event.target.value))}
              />
              <p className="field__hint" id={field('expected-hint')}>
                Solo una previsión: el trasplante se registra cuando se hace.
              </p>
            </div>
          ) : null}
          <div className="field">
            <label className="field__label" htmlFor={field('notes')}>
              Observaciones de la siembra (opcional)
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
          <div className="field">
            <label className="field__label" htmlFor={field('batch-notes')}>
              Observaciones de la tanda (opcional)
            </label>
            <input
              id={field('batch-notes')}
              className="field__input"
              maxLength={500}
              autoComplete="off"
              value={batchNotes}
              onChange={(event) => change(() => setBatchNotes(event.target.value))}
            />
          </div>
        </fieldset>
        <DialogStatus busy={isSubmitting} busyLabel="Guardando…" error={error} />
        <div className="dialog__actions">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Registrar siembra
          </Button>
        </div>
      </form>
    </Modal>
  );
}
