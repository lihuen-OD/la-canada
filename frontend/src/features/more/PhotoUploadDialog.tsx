import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { uploadPhoto } from '../../api/moreApi';
import type { GalleryCategory } from '../../api/moreTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { PHOTO_CATEGORY_OPTION, PHOTO_TYPES, normalizeText } from './moreLabels';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const CATEGORIES: readonly GalleryCategory[] = ['MEMORY', 'TASK_EVIDENCE'];

interface PhotoUploadDialogProps {
  file: File;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}

/**
 * "Guardar foto" (`mo-foto`): vista previa, título ("Sin título" si queda
 * vacío), tipo (📷 Recuerdo / ✅ Tarea) y persona opcional. El backend valida
 * el tipo real y el tamaño; el mismo envío repetido no duplica la foto.
 */
export function PhotoUploadDialog({
  file,
  onClose,
  onSaved,
  onSessionExpired,
}: PhotoUploadDialogProps) {
  const formId = useId();
  const { userId, enabled } = useSessionScope();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GalleryCategory>('MEMORY');
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState<string | null>(() =>
    !PHOTO_TYPES.includes(file.type)
      ? 'La foto debe ser JPG, PNG o WebP.'
      : file.size > MAX_PHOTO_BYTES
        ? 'La foto no puede superar 10 MB.'
        : null,
  );
  const valid = PHOTO_TYPES.includes(file.type) && file.size <= MAX_PHOTO_BYTES;
  const employees = useQuery({
    queryKey: queryKeys.tasks.employees(userId),
    queryFn: fetchTaskEmployees,
    enabled,
    staleTime: STALE_TIME.catalog,
  });

  const preview = useMemo(
    () => (valid && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null),
    [file, valid],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!valid) return;
    const metadata = {
      title: normalizeText(title) || 'Sin título',
      category,
      employeeId: employeeId || null,
    };
    const fingerprint = intentFingerprint(
      `${file.name}:${file.size}:${file.lastModified}`,
      metadata,
    );
    void run(async () => {
      setError(null);
      try {
        await uploadPhoto(file, metadata, intent.current.keyFor(fingerprint));
        intent.current.discard();
        onSaved();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        if (errorCodeOf(caught) !== 'IDEMPOTENCY_RECORD_PENDING') intent.current.discard();
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          Guardar foto
        </h2>
        {preview ? (
          <img className="upload-preview" src={preview} alt="Vista previa de la foto elegida" />
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-name`}>
            Título
          </label>
          <input
            id={`${formId}-name`}
            className="field__input"
            maxLength={80}
            autoComplete="off"
            placeholder="Ej: Jardín después del corte"
            value={title}
            disabled={isSubmitting}
            onChange={(change) => setTitle(change.target.value)}
          />
        </div>
        <div className="more-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-type`}>
              Tipo
            </label>
            <select
              id={`${formId}-type`}
              className="field__input"
              value={category}
              disabled={isSubmitting}
              onChange={(change) => setCategory(change.target.value as GalleryCategory)}
            >
              {CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {PHOTO_CATEGORY_OPTION[option]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-person`}>
              Persona
            </label>
            <select
              id={`${formId}-person`}
              className="field__input"
              value={employeeId}
              disabled={isSubmitting}
              onChange={(change) => setEmployeeId(change.target.value)}
            >
              <option value="">— Sin asignar —</option>
              {(employees.data?.employees ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Subiendo…</span> : null}
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
          <Button type="submit" loading={isSubmitting} disabled={!valid}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
