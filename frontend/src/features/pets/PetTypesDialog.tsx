import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { createPetType, deactivatePetType } from '../../api/petsApi';
import type { PetTypesResponse } from '../../api/petTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorMessageOf, humanError, isSessionExpired } from './petErrors';
import { usePetsCache } from './usePetsCache';

const DEFAULT_ICON = '🐾';

interface PetTypesDialogProps {
  catalog: PetTypesResponse;
  onClose: () => void;
  onSessionExpired: () => void;
}

/**
 * "Gestionar tipos" del prototipo (solo ADMIN): tipos actuales con "×" en
 * los agregados (los 9 precargados no se eliminan) y "Agregar nuevo tipo"
 * con nombre y símbolo. Eliminar es una baja: "Las mascotas de este tipo no
 * se borran". El símbolo elegido ahora se guarda (el prototipo lo perdía).
 */
export function PetTypesDialog({ catalog, onClose, onSessionExpired }: PetTypesDialogProps) {
  const formId = useId();
  const { afterTypeChange } = usePetsCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null);
  const activeTypes = catalog.types.filter((type) => type.active);

  function pickIcon(option: { icon: string; label: string }): void {
    setIcon(option.icon);
    // Como el prototipo: si el nombre está vacío, se sugiere el del símbolo.
    if (!name.trim()) setName(option.label.split('/')[0] ?? '');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      setError('Ingresá un nombre.');
      return;
    }
    void run(async () => {
      setError(null);
      setNotice(null);
      try {
        const { type } = await createPetType({ name: trimmed, icon });
        setName('');
        setIcon(DEFAULT_ICON);
        setNotice(`Tipo agregado: ${type.icon} ${type.name}.`);
        afterTypeChange();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        setError(errorMessageOf(caught));
      }
    });
  }

  if (toRemove) {
    return (
      <ConfirmDialog
        title={`¿Eliminar el tipo "${toRemove.name}"?`}
        description="Las mascotas de este tipo no se borran."
        confirmLabel="Eliminar"
        tone="danger"
        onCancel={() => setToRemove(null)}
        onConfirm={async () => {
          try {
            await deactivatePetType(toRemove.id);
            setToRemove(null);
            afterTypeChange();
          } catch (caught) {
            if (isSessionExpired(caught)) {
              setToRemove(null);
              onSessionExpired();
              return;
            }
            throw humanError(caught);
          }
        }}
      />
    );
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <div className="dialog">
        <h2 id={`${formId}-title`} className="dialog__title">
          Gestionar tipos
        </h2>

        <p className="field__label">Tipos actuales</p>
        <ul className="pet-types" aria-label="Tipos actuales">
          {activeTypes.map((type) => (
            <li key={type.id} className="pet-types__item">
              <span aria-hidden="true">{type.icon}</span>
              <span>{type.name}</span>
              {!type.builtin ? (
                <button
                  type="button"
                  className="pet-types__remove"
                  aria-label={`Eliminar el tipo ${type.name}`}
                  onClick={() => setToRemove({ id: type.id, name: type.name })}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        <form className="pet-types__form" onSubmit={handleSubmit} noValidate>
          <p className="field__label">Agregar nuevo tipo</p>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-name`}>
              Nombre
            </label>
            <input
              id={`${formId}-name`}
              className="field__input"
              maxLength={40}
              autoComplete="off"
              placeholder="Ej: Ternero"
              value={name}
              disabled={isSubmitting}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
          </div>
          <fieldset className="pet-types__picker" disabled={isSubmitting}>
            <legend className="field__label">Símbolo</legend>
            {catalog.iconOptions.map((option) => (
              <button
                key={option.icon}
                type="button"
                className={`pet-types__icon${icon === option.icon ? ' is-selected' : ''}`}
                aria-pressed={icon === option.icon}
                aria-label={option.label}
                title={option.label}
                onClick={() => pickIcon(option)}
              >
                <span aria-hidden="true">{option.icon}</span>
              </button>
            ))}
          </fieldset>
          <div aria-live="polite" className="live-status live-status--start">
            {error ? (
              <span role="alert">
                <AlertIcon size="sm" />
                {error}
              </span>
            ) : null}
            {notice ? <span role="status">{notice}</span> : null}
          </div>
          <Button type="submit" fullWidth loading={isSubmitting}>
            + Agregar tipo
          </Button>
        </form>

        <div className="dialog__actions">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={isSubmitting}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
