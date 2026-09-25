import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateStockDestinationRequest,
  DestinationType,
  StockDestination,
  UpdateStockDestinationRequest,
} from '../../api/stockTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { DESTINATION_TYPE_LABEL } from './stockLabels';

const NAME_MAX = 80;
const TYPES: readonly DestinationType[] = ['VEHICLE', 'SECTOR'];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface DestinationFormDialogProps {
  /** Sin `destination`: alta. Con `destination`: solo se renombra (el tipo es inmutable). */
  destination?: StockDestination;
  onCancel: () => void;
  onSubmit: (body: CreateStockDestinationRequest | UpdateStockDestinationRequest) => Promise<void>;
  onSessionExpired: () => void;
}

/**
 * Alta / renombre de un destino de movimiento (solo ADMIN; el backend decide).
 * En edición el tipo se muestra pero no se envía: cambiarlo alteraría el
 * significado de los consumos históricos. Mismas reglas de texto que el
 * backend (2–80 caracteres, sin HTML).
 */
export function DestinationFormDialog({
  destination,
  onCancel,
  onSubmit,
  onSessionExpired,
}: DestinationFormDialogProps) {
  const titleId = useId();
  const [name, setName] = useState(destination?.name ?? '');
  const [type, setType] = useState<DestinationType>(destination?.type ?? 'VEHICLE');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const isEdit = destination !== undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedName = normalizeText(name);
    if (normalizedName.length < 2) {
      setErrorMessage('El nombre debe tener al menos 2 caracteres.');
      return;
    }
    if (normalizedName.length > NAME_MAX) {
      setErrorMessage(`El nombre no puede superar ${NAME_MAX} caracteres.`);
      return;
    }
    if (/[<>]/.test(normalizedName)) {
      setErrorMessage('El nombre no puede contener HTML.');
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        if (isEdit) {
          if (normalizedName !== destination.name) await onSubmit({ name: normalizedName });
          else onCancel();
          return;
        }
        await onSubmit({ name: normalizedName, type });
      } catch (error) {
        if (isSessionExpired(error)) {
          onSessionExpired();
          return;
        }
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  return (
    <Modal titleId={titleId} onRequestClose={onCancel} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {isEdit ? 'Renombrar destino' : 'Nuevo destino'}
        </h2>
        <p className="dialog__description">
          Los destinos (vehículos o sectores) se eligen, de forma opcional, al registrar un consumo.
        </p>

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-name`}>
            Nombre
          </label>
          <input
            id={`${titleId}-name`}
            className="field__input"
            type="text"
            maxLength={NAME_MAX}
            autoComplete="off"
            value={name}
            disabled={isSubmitting}
            onChange={(event) => {
              setName(event.target.value);
              setErrorMessage(null);
            }}
          />
        </div>

        {isEdit ? (
          <p className="field__hint">
            Tipo: <strong>{DESTINATION_TYPE_LABEL[destination.type]}</strong> (no se puede cambiar).
          </p>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-type`}>
              Tipo
            </label>
            <select
              id={`${titleId}-type`}
              className="field__input"
              value={type}
              disabled={isSubmitting}
              onChange={(event) => setType(event.target.value as DestinationType)}
            >
              {TYPES.map((option) => (
                <option key={option} value={option}>
                  {DESTINATION_TYPE_LABEL[option]}
                </option>
              ))}
            </select>
            <p className="field__hint">El tipo no se podrá cambiar después.</p>
          </div>
        )}

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
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Guardar nombre' : 'Crear destino'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
