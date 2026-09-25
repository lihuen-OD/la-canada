import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { createEmployee, updateEmployee } from '../../api/moreApi';
import type { EmployeeRole, ManagedEmployee } from '../../api/moreTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { DEFAULT_PERSON_COLOR, isPersonColor } from '../../utils/color';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { normalizeText } from './moreLabels';

const ROLES: readonly EmployeeRole[] = ['Doméstica', 'Parque', 'Otro'];

interface EmployeeFormDialogProps {
  employee?: ManagedEmployee;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}

/** "Nueva persona" / "Editar persona" (`mo-persona`): nombre, rol y color. */
export function EmployeeFormDialog({
  employee,
  onClose,
  onSaved,
  onSessionExpired,
}: EmployeeFormDialogProps) {
  const formId = useId();
  const { isSubmitting, run } = useSubmitGuard();
  const [name, setName] = useState(employee?.displayName ?? '');
  const [role, setRole] = useState<EmployeeRole>(
    (ROLES as readonly string[]).includes(employee?.role ?? '')
      ? (employee?.role as EmployeeRole)
      : 'Doméstica',
  );
  const [color, setColor] = useState(
    employee && isPersonColor(employee.colorHex) ? employee.colorHex : DEFAULT_PERSON_COLOR,
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const clean = normalizeText(name);
    if (!clean) {
      setError('Ingresá un nombre.');
      return;
    }
    const body = { displayName: clean, role, colorHex: color };
    void run(async () => {
      setError(null);
      try {
        if (employee) await updateEmployee(employee.id, body);
        else await createEmployee(body);
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
          {employee ? 'Editar persona' : 'Nueva persona'}
        </h2>
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-name`}>
            Nombre
          </label>
          <input
            id={`${formId}-name`}
            className="field__input"
            maxLength={40}
            autoComplete="off"
            placeholder="Ej: Coke"
            value={name}
            disabled={isSubmitting}
            onChange={(change) => setName(change.target.value)}
          />
        </div>
        <div className="more-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-role`}>
              Rol
            </label>
            <select
              id={`${formId}-role`}
              className="field__input"
              value={role}
              disabled={isSubmitting}
              onChange={(change) => setRole(change.target.value as EmployeeRole)}
            >
              {ROLES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-color`}>
              Color
            </label>
            <input
              id={`${formId}-color`}
              className="field__input field__input--color"
              type="color"
              value={color}
              disabled={isSubmitting}
              onChange={(change) => setColor(change.target.value)}
            />
          </div>
        </div>
        {!employee ? (
          <p className="field__hint">
            La persona queda pendiente de activación: asignale su PIN con 🔑 para que pueda
            ingresar.
          </p>
        ) : null}
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
