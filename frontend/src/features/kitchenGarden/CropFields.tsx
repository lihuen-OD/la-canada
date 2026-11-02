import { useCallback, useState } from 'react';
import { ApiError } from '../../api/httpClient';
import { OfflineError } from '../../api/transportErrors';
import type { GardenParticipant, GardenPerson } from '../../api/kitchenGardenTypes';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { useGardenCache } from './useGardenCache';

/**
 * Piezas compartidas de los diálogos de 🥕 Cultivos: quién realizó el hecho,
 * el estado del envío y el manejo de errores. Los borradores se conservan
 * ante cualquier falla: el diálogo solo se cierra cuando el backend confirma.
 */

/** Conflictos de concurrencia: la pantalla se actualiza detrás y el diálogo explica qué hacer. */
const CONFLICT_MESSAGES: Readonly<Record<string, string>> = {
  GARDEN_BATCH_CHANGED:
    'Otra persona cambió esta tanda mientras la tenías abierta. Tocá «Cancelar» para ver los datos actuales y volvé a intentar.',
  GARDEN_CROP_RECORD_CHANGED:
    'Otra persona corrigió este registro mientras lo tenías abierto. Tocá «Cancelar» para ver los datos actuales y volvé a intentar.',
};

/**
 * Envío de un diálogo: un solo envío a la vez (`useSubmitGuard`), sesión
 * vencida → login, 409 → refresca lo que se ve detrás sin cerrar el diálogo.
 * `retryable` indica si conviene conservar la clave de idempotencia (falla
 * de red o del servidor: el reintento no duplica).
 */
export function useCropSubmit(onSessionExpired: () => void) {
  const { isSubmitting, run } = useSubmitGuard();
  const { afterCropChange } = useGardenCache();
  const [error, setError] = useState<string | null>(null);
  const submit = useCallback(
    (action: () => Promise<void>, onFailure?: (retryable: boolean) => void) =>
      run(async () => {
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
          if (caught instanceof ApiError && caught.status === 409) afterCropChange();
          onFailure?.(retryable);
          setError(
            (caught instanceof ApiError && caught.code && CONFLICT_MESSAGES[caught.code]) ||
              errorMessageOf(caught),
          );
        }
      }),
    [run, onSessionExpired, afterCropChange],
  );
  return { isSubmitting, error, setError, submit };
}

/** Estado del envío (anunciado) y el error, con el mismo marcado de los diálogos de Tareas. */
export function DialogStatus({
  busy,
  busyLabel,
  error,
}: {
  busy: boolean;
  busyLabel: string;
  error: string | null;
}) {
  return (
    <div aria-live="assertive" className="live-status live-status--start">
      {busy ? <span role="status">{busyLabel}</span> : null}
      {error ? (
        <span role="alert">
          <AlertIcon size="sm" />
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface PersonSelectProps {
  id: string;
  label: string;
  value: string;
  participants: GardenParticipant[];
  /** Quien figura hoy en el registro: se conserva aunque ya no participe. */
  current?: GardenPerson | null;
  disabled?: boolean;
  onChange: (participantId: string) => void;
}

/**
 * «¿Quién lo hizo?»: participantes ACTIVOS de la Huerta. Para un empleado
 * participante viene preseleccionada su participación (lo decide el
 * diálogo); elegir a otra persona es una elección explícita en este campo.
 */
export function PersonSelect({
  id,
  label,
  value,
  participants,
  current,
  disabled,
  onChange,
}: PersonSelectProps) {
  const active = participants.filter((participant) => participant.active);
  const keepCurrent = current && !active.some((participant) => participant.id === current.id);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field__input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {value === '' ? <option value="">Elegí quién lo hizo</option> : null}
        {keepCurrent ? (
          <option value={current.id}>{current.displayName} (ya no participa)</option>
        ) : null}
        {active.map((participant) => (
          <option key={participant.id} value={participant.id}>
            {participant.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
