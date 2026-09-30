import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  CreateStockItemRequest,
  StockCategory,
  StockItem,
  StockItemArea,
  UpdateStockItemRequest,
} from '../../api/stockTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { AREA_LABEL, TARGET_HINT } from './stockLabels';

const NAME_MAX = 100;
const UNIT_MAX = 30;
/** Umbral no negativo, misma representación que el backend (`stockMinimumQuantityTextSchema`). */
const MINIMUM_PATTERN = /^(?:0(?:\.\d{1,2})?|[1-9]\d{0,7}(?:\.\d{1,2})?)$/;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface ItemFormDialogProps {
  /** Sin `item`: creación (arranca en saldo 0). Con `item`: edición (sin cantidad ni área). */
  item?: StockItem;
  /** Categorías visibles para el área elegida (activas + la actual si quedó inactiva). */
  categories: StockCategory[];
  /** Área preseleccionada al crear desde 🏠 Casa / 🌿 Jardín (como el "+ Agregar ítem" del prototipo). */
  defaultArea?: StockItemArea;
  onCancel: () => void;
  onSubmit: (body: CreateStockItemRequest | UpdateStockItemRequest) => Promise<void>;
  onSessionExpired: () => void;
}

/**
 * Alta/edición de productos. En creación el área sí se elige (nunca
 * `BOTH`: `StockItem.area` no lo admite) y el saldo arranca en 0 — la
 * primera carga es un `INCOME`. En edición el área es inmutable y la
 * cantidad solo cambia vía movimientos (el schema del backend es
 * `.strict()` y rechaza `currentQuantity`).
 */
export function ItemFormDialog({
  item,
  categories,
  defaultArea,
  onCancel,
  onSubmit,
  onSessionExpired,
}: ItemFormDialogProps) {
  const titleId = useId();
  const isEdit = item !== undefined;
  const [name, setName] = useState(item?.name ?? '');
  const [area, setArea] = useState<StockItemArea>(item?.area ?? defaultArea ?? 'HOUSE');
  const [categoryId, setCategoryId] = useState(item?.category.id ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [minimumQuantity, setMinimumQuantity] = useState(item?.minimumQuantity ?? '0');
  /** Vacío solo en un producto anterior que todavía no lo tiene («pendiente»). */
  const [targetQuantity, setTargetQuantity] = useState(item?.targetQuantity ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  // Asignables: del área elegida (o Ambas), activas — más la categoría
  // actual del producto aunque esté inactiva, para no "perderla" en el select.
  const assignable = categories.filter(
    (category) =>
      (category.area === area || category.area === 'BOTH') &&
      (category.active || category.id === item?.category.id),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalizedName = normalizeText(name);
    const normalizedUnit = normalizeText(unit);
    const normalizedMinimum = minimumQuantity.trim();
    const normalizedTarget = targetQuantity.trim();
    const minimumChanged = !isEdit || normalizedMinimum !== item.minimumQuantity;
    const targetChanged = normalizedTarget !== (item?.targetQuantity ?? '');

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
    if (!isEdit && !categoryId) {
      setErrorMessage('Elegí una categoría.');
      return;
    }
    if (categoryId && !assignable.some((category) => category.id === categoryId)) {
      setErrorMessage('La categoría no corresponde al área indicada.');
      return;
    }
    if (normalizedUnit.length < 1) {
      setErrorMessage('La unidad es obligatoria.');
      return;
    }
    if (normalizedUnit.length > UNIT_MAX) {
      setErrorMessage(`La unidad no puede superar ${UNIT_MAX} caracteres.`);
      return;
    }
    if (/[<>]/.test(normalizedUnit)) {
      setErrorMessage('La unidad no puede contener HTML.');
      return;
    }
    if (!MINIMUM_PATTERN.test(normalizedMinimum)) {
      setErrorMessage('El stock mínimo debe ser un número no negativo con hasta 2 decimales.');
      return;
    }
    // Un producto anterior sin objetivo puede editar nombre, categoría o
    // unidad sin completarlo; cambiar el mínimo (o crear) sí lo exige. El
    // backend vuelve a validarlo con Decimal.
    if (normalizedTarget === '' && (minimumChanged || targetChanged)) {
      setErrorMessage(
        isEdit
          ? 'Completá el stock objetivo para cambiar el stock mínimo.'
          : 'El stock objetivo es obligatorio.',
      );
      return;
    }
    if (normalizedTarget !== '') {
      if (!MINIMUM_PATTERN.test(normalizedTarget)) {
        setErrorMessage('El stock objetivo debe ser un número no negativo con hasta 2 decimales.');
        return;
      }
      // Hasta 2 decimales y 8 enteros: la comparación con Number es exacta.
      if (Number(normalizedTarget) <= Number(normalizedMinimum)) {
        setErrorMessage('El stock objetivo debe ser mayor que el stock mínimo.');
        return;
      }
    }

    void run(async () => {
      setErrorMessage(null);
      try {
        if (!isEdit) {
          await onSubmit({
            name: normalizedName,
            area,
            categoryId,
            unit: normalizedUnit,
            minimumQuantity: normalizedMinimum,
            targetQuantity: normalizedTarget,
          });
          return;
        }
        const changes: UpdateStockItemRequest = {};
        if (normalizedName !== item.name) changes.name = normalizedName;
        if (categoryId !== item.category.id) changes.categoryId = categoryId;
        if (normalizedUnit !== item.unit) changes.unit = normalizedUnit;
        if (minimumChanged) changes.minimumQuantity = normalizedMinimum;
        if (targetChanged) changes.targetQuantity = normalizedTarget;
        if (Object.keys(changes).length === 0) {
          onCancel();
          return;
        }
        await onSubmit(changes);
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
      <form className="dialog dialog--prototype" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {isEdit ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        {!isEdit ? (
          <p className="field__hint">
            El producto se crea con saldo 0. La primera carga se registra como ingreso desde el
            listado.
          </p>
        ) : null}

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
            El área «{AREA_LABEL[item.area]}» no se puede cambiar en un producto existente.
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
              onChange={(event) => {
                const next = event.target.value as StockItemArea;
                setArea(next);
                // La categoría anterior puede no ser asignable al nuevo área.
                const stillAssignable = categories.some(
                  (category) =>
                    category.id === categoryId &&
                    (category.area === next || category.area === 'BOTH'),
                );
                if (!stillAssignable) setCategoryId('');
                setErrorMessage(null);
              }}
            >
              <option value="HOUSE">{AREA_LABEL.HOUSE}</option>
              <option value="GARDEN">{AREA_LABEL.GARDEN}</option>
            </select>
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor={`${titleId}-category`}>
            Categoría
          </label>
          <select
            id={`${titleId}-category`}
            className="field__input"
            value={categoryId}
            disabled={isSubmitting}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setErrorMessage(null);
            }}
          >
            <option value="">Elegí una categoría</option>
            {assignable.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {!category.active ? ' (inactiva)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-unit`}>
              Unidad
            </label>
            <input
              id={`${titleId}-unit`}
              className="field__input"
              type="text"
              maxLength={UNIT_MAX}
              autoComplete="off"
              placeholder="kg, litros, unidades…"
              value={unit}
              disabled={isSubmitting}
              onChange={(event) => {
                setUnit(event.target.value);
                setErrorMessage(null);
              }}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-minimum`}>
              Stock mínimo
            </label>
            <input
              id={`${titleId}-minimum`}
              className="field__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={minimumQuantity}
              disabled={isSubmitting}
              onChange={(event) => {
                setMinimumQuantity(event.target.value);
                setErrorMessage(null);
              }}
            />
            <p className="field__hint">
              En este valor o por debajo, el producto queda crítico y entra en Compras. Admite 0.
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor={`${titleId}-target`}>
              Stock objetivo
            </label>
            <input
              id={`${titleId}-target`}
              className="field__input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={targetQuantity}
              // Corto a propósito: en móvil el campo ocupa media fila.
              placeholder={isEdit && item.targetQuantity === null ? 'Pendiente' : undefined}
              aria-describedby={`${titleId}-target-hint`}
              disabled={isSubmitting}
              onChange={(event) => {
                setTargetQuantity(event.target.value);
                setErrorMessage(null);
              }}
            />
            <p className="field__hint" id={`${titleId}-target-hint`}>
              {TARGET_HINT} Debe ser mayor que el mínimo.
            </p>
          </div>
        </div>

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
            onClick={() => {
              if (!isSubmitting) onCancel();
            }}
            disabled={isSubmitting}
          >
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Guardar cambios' : 'Crear producto'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
