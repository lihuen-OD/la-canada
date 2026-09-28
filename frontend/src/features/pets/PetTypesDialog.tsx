import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { createPetType, deletePetType, setPetTypeActive } from '../../api/petsApi';
import type { PetTypesResponse } from '../../api/petTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { DeleteConfirmDialog } from '../admin/DeleteConfirmDialog';
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
 * "Gestionar tipos" del prototipo (solo ADMIN): tipos actuales y "Agregar
 * nuevo tipo" con nombre y símbolo. Los 9 precargados no cambian. Un tipo
 * agregado se puede desactivar ("Las mascotas de este tipo no se borran"),
 * reactivar, o eliminar definitivamente si ninguna mascota lo usa. El
 * símbolo elegido se guarda (el prototipo lo perdía).
 */
export function PetTypesDialog({ catalog, onClose, onSessionExpired }: PetTypesDialogProps) {
  const formId = useId();
  const { afterTypeChange } = usePetsCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_ICON);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    kind: 'deactivate' | 'reactivate' | 'delete';
    id: string;
    name: string;
  } | null>(null);
  const activeTypes = catalog.types.filter((type) => type.active);
  const inactiveTypes = catalog.types.filter((type) => !type.active && !type.builtin);

  /** Aplica la acción; una sesión vencida cierra el diálogo y vuelve al login. */
  async function apply(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (caught) {
      if (isSessionExpired(caught)) {
        setPending(null);
        onSessionExpired();
        return;
      }
      throw humanError(caught);
    }
    setPending(null);
    afterTypeChange();
  }

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

  if (pending?.kind === 'delete') {
    return (
      <DeleteConfirmDialog
        entityLabel="el tipo"
        name={pending.name}
        keepWhen="alguna mascota lo usa (aunque esté inactiva)"
        onCancel={() => setPending(null)}
        onConfirm={() => apply(() => deletePetType(pending.id))}
      />
    );
  }

  if (pending) {
    const deactivate = pending.kind === 'deactivate';
    return (
      <ConfirmDialog
        title={deactivate ? `Desactivar el tipo «${pending.name}»` : `Reactivar «${pending.name}»`}
        description={
          deactivate
            ? 'Deja de ofrecerse para mascotas nuevas. Las mascotas de este tipo no se borran ni cambian.'
            : 'Vuelve a ofrecerse al agregar o editar mascotas.'
        }
        confirmLabel={deactivate ? 'Desactivar' : 'Reactivar'}
        tone={deactivate ? 'danger' : 'default'}
        onCancel={() => setPending(null)}
        onConfirm={() => apply(() => setPetTypeActive(pending.id, !deactivate))}
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
                <span className="pet-types__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPending({ kind: 'deactivate', id: type.id, name: type.name })}
                  >
                    Desactivar <span className="visually-hidden">el tipo {type.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setPending({ kind: 'delete', id: type.id, name: type.name })}
                  >
                    Eliminar <span className="visually-hidden">el tipo {type.name}</span>
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {inactiveTypes.length ? (
          <>
            <p className="field__label">Tipos inactivos</p>
            <ul className="pet-types" aria-label="Tipos inactivos">
              {inactiveTypes.map((type) => (
                <li key={type.id} className="pet-types__item is-inactive">
                  <span aria-hidden="true">{type.icon}</span>
                  <span>{type.name}</span>
                  <span className="pet-types__actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setPending({ kind: 'reactivate', id: type.id, name: type.name })
                      }
                    >
                      Reactivar <span className="visually-hidden">el tipo {type.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setPending({ kind: 'delete', id: type.id, name: type.name })}
                    >
                      Eliminar <span className="visually-hidden">el tipo {type.name}</span>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

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
