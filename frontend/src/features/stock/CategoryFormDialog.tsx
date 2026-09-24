import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateStockCategoryRequest,
  StockCategory,
  StockCategoryArea,
  UpdateStockCategoryRequest,
} from '../../api/stockTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { AREA_LABEL } from './stockLabels';

const NAME_MAX = 80;
const AREAS: readonly StockCategoryArea[] = ['HOUSE', 'GARDEN', 'BOTH'];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface CategoryFormDialogProps {
  /** Sin `category`: creación. Con `category`: solo se edita el nombre (el área es inmutable en el backend). */
  category?: StockCategory;
  onCancel: () => void;
  onSubmit: (body: CreateStockCategoryRequest | UpdateStockCategoryRequest) => Promise<void>;
  onSessionExpired: () => void;
}

export function CategoryFormDialog({
  category,
  onCancel,
  onSubmit,
  onSessionExpired,
}: CategoryFormDialogProps) {
  const titleId = useId();
  const [name, setName] = useState(category?.name ?? '');
  const [area, setArea] = useState<StockCategoryArea>(category?.area ?? 'HOUSE');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const isEdit = category !== undefined;

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
          if (normalizedName !== category.name) await onSubmit({ name: normalizedName });
          else onCancel();
          return;
        }
        await onSubmit({ name: normalizedName, area });
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
    <Modal
      titleId={titleId}
      onRequestClose={() => {
        if (!isSubmitting) onCancel();
      }}
      closeDisabled={isSubmitting}
    >
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {isEdit ? 'Editar categoría' : 'Nueva categoría'}
        </h2>

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
            El área es «{AREA_LABEL[category.area]}» y no se puede cambiar: mover la categoría
            rompería la compatibilidad con sus productos.
          </p>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-area`}>
              Área
            </label>
            <select
              id={`${titleId}-area`}
              className="field__input"
              value={area}
              disabled={isSubmitting}
              onChange={(event) => setArea(event.target.value as StockCategoryArea)}
            >
              {AREAS.map((value) => (
                <option key={value} value={value}>
                  {AREA_LABEL[value]}
                  {value === 'BOTH' ? ' (compartida entre Casa y Jardín)' : ''}
                </option>
              ))}
            </select>
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
          <Button
            variant="secondary"
            onClick={() => !isSubmitting && onCancel()}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear categoría'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
