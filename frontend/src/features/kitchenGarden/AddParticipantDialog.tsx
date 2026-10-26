import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addGardenParticipant, fetchGardenCandidates } from '../../api/kitchenGardenApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired } from '../tasks/dialogErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';

interface AddParticipantDialogProps {
  onCancel: () => void;
  /** Con el nombre de quien quedó agregado (para el aviso). */
  onAdded: (displayName: string) => void;
  onSessionExpired: () => void;
}

/**
 * «Agregar participante» (ADMIN): elegir un usuario ACTIVO existente de la
 * app — empleado o administrador, una sola vez por persona. Sin preselección
 * ni personas fijas: la lista sale del backend (`/participants/candidates`).
 * Participar no cambia el rol ni crea usuarios o empleados.
 */
export function AddParticipantDialog({
  onCancel,
  onAdded,
  onSessionExpired,
}: AddParticipantDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { userId, enabled } = useSessionScope();
  const [selected, setSelected] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const candidatesQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.candidates(userId),
    queryFn: fetchGardenCandidates,
    enabled,
  });
  const expired = isSessionExpired(candidatesQuery.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  const candidates = candidatesQuery.data?.candidates;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const chosen = candidates?.find((candidate) => candidate.userId === selected);
    if (!chosen) {
      setErrorMessage('Elegí una persona.');
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        await addGardenParticipant(chosen.userId);
        onAdded(chosen.displayName);
      } catch (error) {
        if (isSessionExpired(error)) return onSessionExpired();
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (!isSubmitting) onCancel();
  }

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={handleCancel}
      closeDisabled={isSubmitting}
    >
      <form className="dialog dialog--prototype" onSubmit={handleSubmit}>
        <h2 id={titleId} className="dialog__title">
          <span aria-hidden="true">👥 </span>Agregar participante
        </h2>
        <p id={descriptionId} className="dialog__description">
          Elegí una persona que ya usa la app. Va a poder completar las actividades que le asignes;
          su rol y sus permisos no cambian.
        </p>

        {!candidates ? (
          candidatesQuery.isError ? (
            <ErrorState
              titleAs="p"
              title="No pudimos cargar las personas."
              onRetry={() => void candidatesQuery.refetch()}
            />
          ) : (
            <LoadingState label="Cargando personas…" />
          )
        ) : candidates.length === 0 ? (
          <p className="field__hint">
            No hay más usuarios activos para agregar. Si falta alguien, activá su cuenta en
            Usuarios.
          </p>
        ) : (
          <fieldset className="choice-list" disabled={isSubmitting}>
            <legend className="field__label">Persona</legend>
            {candidates.map((candidate) => (
              <label key={candidate.userId} className="choice">
                <input
                  type="radio"
                  name={`${titleId}-candidate`}
                  value={candidate.userId}
                  checked={selected === candidate.userId}
                  onChange={() => {
                    setSelected(candidate.userId);
                    setErrorMessage(null);
                  }}
                />
                <Avatar name={candidate.displayName} colorHex={candidate.colorHex} size="sm" />
                <span>{candidate.displayName}</span>
                <span className="choice__hint">
                  {candidate.roleLabel}
                  {candidate.returning ? ' · ya participó' : ''}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Agregando…</span> : null}
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
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={!candidates || candidates.length === 0}
          >
            Agregar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
