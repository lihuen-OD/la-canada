import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { updateGardenBatch, voidGardenCropRecord } from '../../api/kitchenGardenApi';
import type {
  GardenBatchDetail,
  GardenCrop,
  GardenCropRecord,
  UpdateGardenBatchRequest,
} from '../../api/kitchenGardenTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatDate } from '../../utils/dateFormat';
import { DialogStatus, useCropSubmit } from './CropFields';
import { RECORD_TYPE_LABEL } from './cropLabels';
import { useGardenCache } from './useGardenCache';

const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

interface BatchDialogProps {
  batch: GardenBatchDetail;
  onClose: () => void;
  onSaved: (batch: GardenBatchDetail) => void;
  onSessionExpired: () => void;
}

/**
 * «Editar tanda»: cultivo, nombre, variedad y observaciones. Solo envía lo
 * que cambió, con la versión que se abrió (409 si otra persona la cambió);
 * sin cambios, cierra sin enviar nada.
 */
export function BatchEditDialog({
  batch,
  crops,
  onClose,
  onSaved,
  onSessionExpired,
}: BatchDialogProps & { crops: GardenCrop[] }) {
  const formId = useId();
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  const [opened] = useState(batch);
  const [cropName, setCropName] = useState(opened.crop.name);
  const [name, setName] = useState(opened.name);
  const [variety, setVariety] = useState(opened.variety ?? '');
  const [notes, setNotes] = useState(opened.notes ?? '');
  const field = (key: string) => `${formId}-${key}`;
  const change = (apply: () => void) => {
    apply();
    setError(null);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!clean(cropName)) return setError('Indicá el cultivo.');
    if (!clean(name)) return setError('Indicá el nombre de la tanda.');
    const body: UpdateGardenBatchRequest = { version: opened.version };
    if (
      clean(cropName).toLocaleLowerCase('es-AR') !== opened.crop.name.toLocaleLowerCase('es-AR')
    ) {
      body.cropName = clean(cropName);
    }
    if (clean(name) !== opened.name) body.name = clean(name);
    if (clean(variety) !== (opened.variety ?? '')) body.variety = clean(variety) || null;
    if (clean(notes) !== (opened.notes ?? '')) body.notes = clean(notes) || null;
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void submit(async () => {
      const result = await updateGardenBatch(opened.id, body);
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
          Editar tanda
        </h2>
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
            <label className="field__label" htmlFor={field('name')}>
              Nombre de la tanda
            </label>
            <input
              id={field('name')}
              className="field__input"
              maxLength={80}
              autoComplete="off"
              value={name}
              onChange={(event) => change(() => setName(event.target.value))}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={field('notes')}>
              Observaciones de la tanda (opcional)
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

/**
 * «Trasplantes previstos»: si quedan pendientes y su fecha prevista, o la
 * confirmación «No quedan trasplantes pendientes» (con quién y cuándo, en el
 * backend). Una fecha prevista nunca registra un trasplante.
 */
export function TransplantPlanDialog({
  batch,
  onClose,
  onSaved,
  onSessionExpired,
}: BatchDialogProps) {
  const formId = useId();
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  const [opened] = useState(batch);
  const [pending, setPending] = useState(opened.transplantPlan.pending);
  const [expected, setExpected] = useState(opened.transplantPlan.expectedDate ?? '');
  const sowingDate = opened.sowing?.performedOn ?? '';
  const field = (key: string) => `${formId}-${key}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const expectedNext = pending ? expected : '';
    if (pending && expected && sowingDate && expected < sowingDate) {
      setError('La fecha prevista no puede ser anterior a la siembra.');
      return;
    }
    const body: UpdateGardenBatchRequest = { version: opened.version };
    if (pending !== opened.transplantPlan.pending) body.transplantPending = pending;
    if (expectedNext !== (opened.transplantPlan.expectedDate ?? '')) {
      body.expectedTransplantDate = expectedNext || null;
    }
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void submit(async () => {
      const result = await updateGardenBatch(opened.id, body);
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
          Trasplantes previstos
        </h2>
        <p className="field__hint">
          {opened.crop.name} · {opened.name}
        </p>
        <fieldset className="crop-form__group" disabled={isSubmitting}>
          <fieldset className="choice-list crop-form__choices">
            <legend className="field__label">¿Quedan trasplantes pendientes?</legend>
            <label className="choice">
              <input
                type="radio"
                name={field('pending')}
                checked={pending}
                onChange={() => {
                  setPending(true);
                  setError(null);
                }}
              />
              <span>Sí, quedan pendientes</span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name={field('pending')}
                checked={!pending}
                onChange={() => {
                  setPending(false);
                  setError(null);
                }}
              />
              <span>No quedan trasplantes pendientes</span>
            </label>
          </fieldset>
          {pending ? (
            <div className="field">
              <label className="field__label" htmlFor={field('expected')}>
                Fecha prevista (opcional)
              </label>
              <input
                id={field('expected')}
                className="field__input"
                type="date"
                min={sowingDate || undefined}
                value={expected}
                onChange={(event) => {
                  setExpected(event.target.value);
                  setError(null);
                }}
              />
            </div>
          ) : null}
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

/**
 * Anular una siembra o un trasplante: confirmación con motivo obligatorio.
 * Nunca borra: deja de verse en la ficha y en Registros y queda en la
 * auditoría. La siembra con trasplantes vigentes no se anula (lo explica el
 * backend con 409).
 */
export function VoidRecordDialog({
  record,
  onClose,
  onVoided,
  onSessionExpired,
}: {
  record: GardenCropRecord;
  onClose: () => void;
  onVoided: () => void;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { afterCropChange } = useGardenCache();
  const { isSubmitting, error, setError, submit } = useCropSubmit(onSessionExpired);
  const [reason, setReason] = useState('');
  const field = (key: string) => `${formId}-${key}`;
  const sowing = record.type === 'SOWING';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (clean(reason).length < 3) {
      setError('Indicá el motivo (al menos 3 caracteres).');
      return;
    }
    void submit(async () => {
      await voidGardenCropRecord(record.id, clean(reason));
      afterCropChange();
      onVoided();
    });
  }

  const close = () => {
    if (!isSubmitting) onClose();
  };

  return (
    <Modal
      titleId={field('title')}
      descriptionId={field('description')}
      onRequestClose={close}
      closeDisabled={isSubmitting}
    >
      <form className="dialog dialog--prototype crop-form" onSubmit={handleSubmit} noValidate>
        <h2 id={field('title')} className="dialog__title">
          ¿Anular {sowing ? 'la siembra' : 'el trasplante'}?
        </h2>
        <p id={field('description')} className="dialog__description">
          {RECORD_TYPE_LABEL[record.type]} del {formatDate(record.performedOn)} · {record.location}.{' '}
          {sowing
            ? 'La tanda queda sin siembra vigente: sale de Cultivos y no admite registros nuevos.'
            : 'Deja de verse en la ficha y en Registros.'}{' '}
          No se borra: queda en la auditoría con el motivo.
        </p>
        <div className="field">
          <label className="field__label" htmlFor={field('reason')}>
            Motivo
          </label>
          <input
            id={field('reason')}
            className="field__input"
            maxLength={300}
            autoComplete="off"
            placeholder="Ej: Cargado dos veces"
            value={reason}
            disabled={isSubmitting}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
        </div>
        <DialogStatus busy={isSubmitting} busyLabel="Anulando…" error={error} />
        <div className="dialog__actions">
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={isSubmitting}>
            Anular
          </Button>
        </div>
      </form>
    </Modal>
  );
}
