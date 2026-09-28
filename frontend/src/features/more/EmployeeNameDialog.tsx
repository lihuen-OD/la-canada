import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { updateEmployee } from '../../api/moreApi';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { PERSON_NAME_MAX, normalizePersonName, personNameError } from '../../utils/personName';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';

interface EmployeeNameDialogProps {
  employee: { id: string; displayName: string };
  onClose: () => void;
  /** `changed`: el nombre realmente cambió (para invalidar lo que muestra nombres). */
  onSaved: (displayName: string, changed: boolean) => void;
  onSessionExpired: () => void;
}

/**
 * "Editar nombre" en Datos del equipo (solo ADMIN, Etapa 5F): corrige el
 * nombre visible de una persona con el endpoint administrativo existente
 * (`PATCH /employees/:id`, solo `displayName`). No toca código, usuario, PIN,
 * sesiones, asignaciones ni historial.
 */
export function EmployeeNameDialog({
  employee,
  onClose,
  onSaved,
  onSessionExpired,
}: EmployeeNameDialogProps) {
  const formId = useId();
  const { isSubmitting, run } = useSubmitGuard();
  const [name, setName] = useState(employee.displayName);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const problem = personNameError(name);
    if (problem) {
      setError(problem);
      return;
    }
    const displayName = normalizePersonName(name);
    if (displayName === employee.displayName) {
      onSaved(displayName, false);
      return;
    }
    void run(async () => {
      setError(null);
      try {
        const saved = await updateEmployee(employee.id, { displayName });
        onSaved(saved.employee.displayName, true);
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
          Editar nombre
        </h2>
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-name`}>
            Nombre visible
          </label>
          <input
            id={`${formId}-name`}
            className="field__input"
            maxLength={PERSON_NAME_MAX}
            autoComplete="off"
            value={name}
            disabled={isSubmitting}
            onChange={(change) => setName(change.target.value)}
          />
        </div>
        <p className="dialog__description">
          Se actualiza en toda la app. No cambia su usuario, su PIN ni su historial.
        </p>
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
