import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import type { CreateStockMovementRequest, StockDestination, StockItem } from '../../api/stockTypes';
import type { SystemRole } from '../../api/types';
import { fetchStockDestinations } from '../../api/stockApi';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { MOVEMENT_LABEL } from './stockLabels';

export type MovementKind = 'income' | 'consumption' | 'adjustment';

const KIND_TYPE = {
  income: 'INCOME',
  consumption: 'CONSUMPTION',
  adjustment: 'ADJUSTMENT_INCREASE', // la dirección la elige el ADMIN en el paso de confirmación
} as const;

const KIND_TITLE: Record<MovementKind, string> = {
  income: '➕ Registrar ingreso',
  consumption: '➖ Registrar consumo',
  adjustment: '⚙️ Registrar ajuste',
};

const KIND_INTRO: Record<MovementKind, string> = {
  income: 'Suma al stock del producto. El responsable de la operación sos vos (sale de tu sesión).',
  consumption:
    'Resta stock del producto. El responsable de la operación sos vos (sale de tu sesión).',
  adjustment:
    'Corrección de inventario exclusiva de administradores. Se registra en el historial con su motivo.',
};

/**
 * Misma representación decimal estricta que el backend
 * (`stockQuantityTextSchema`): hasta 8 enteros y 2 decimales, positivo.
 */
const QUANTITY_PATTERN = /^(?:0\.\d{1,2}|[1-9]\d{0,7}(?:\.\d{1,2})?)$/;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface MovementDialogProps {
  item: StockItem;
  kind: MovementKind;
  /** Rol real de `useAuth().user`; nunca se infiere desde el tipo de movimiento. */
  role: SystemRole | undefined;
  onCancel: () => void;
  onConfirm: (body: CreateStockMovementRequest) => Promise<void>;
  onSessionExpired: () => void;
}

/**
 * Modal único "Registrar movimiento" (docs/BUSINESS_RULES.md §8), con los
 * tres modos reales del contrato 5A. Nunca envía `employeeId` ni
 * `stockItemId`. EMPLOYEE no envía `effectiveDate` (la decide el backend
 * como hoy en `BUSINESS_TIME_ZONE`); ADMIN puede elegir una fecha pasada y
 * el backend rechaza cualquier futura. Los ajustes exigen motivo y un paso
 * extra de confirmación que muestra el saldo actual y la cantidad — sin
 * calcular un saldo resultante ni presuponer que el backend lo aceptará.
 */
export function MovementDialog({
  item,
  kind,
  role,
  onCancel,
  onConfirm,
  onSessionExpired,
}: MovementDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const isAdmin = role === 'ADMIN';
  const [today] = useState(localCalendarDate);
  const [quantity, setQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [reason, setReason] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<
    'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE'
  >('ADJUSTMENT_INCREASE');
  const [confirmStep, setConfirmStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const { userId, enabled } = useSessionScope();

  // Solo el consumo necesita el catálogo de destinos (opcional en el
  // contrato). Catálogo casi estático: se reutiliza entre consumos (Etapa 5P).
  const destinationsQuery = useQuery({
    queryKey: queryKeys.stock.destinations(userId),
    queryFn: fetchStockDestinations,
    enabled: enabled && kind === 'consumption',
    staleTime: STALE_TIME.catalog,
  });
  const destinationsExpired = isSessionExpired(destinationsQuery.error);
  useEffect(() => {
    if (destinationsExpired) onSessionExpired();
  }, [destinationsExpired, onSessionExpired]);
  // Un fallo al listar destinos no bloquea el consumo: son opcionales.
  const destinations: StockDestination[] | null = destinationsQuery.data
    ? destinationsQuery.data.destinations
    : destinationsQuery.isError
      ? []
      : null;

  const isAdjustment = kind === 'adjustment';
  const showDestination = kind === 'consumption';
  const showDate = isAdmin; // EMPLOYEE: sin campo, sin cálculo de fecha en el navegador

  function validate(): string | null {
    const normalizedQuantity = quantity.trim();
    if (!normalizedQuantity) return 'La cantidad es obligatoria.';
    if (!QUANTITY_PATTERN.test(normalizedQuantity))
      return 'La cantidad debe ser un número positivo con hasta 2 decimales.';
    if (/^0+(\.0+)?$/.test(normalizedQuantity)) return 'La cantidad debe ser mayor a cero.';

    if (showDate && effectiveDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))
        return 'La fecha debe tener formato YYYY-MM-DD.';
      if (effectiveDate > today) return 'La fecha no puede ser futura.';
    }

    const normalizedReason = normalizeText(reason);
    if (isAdjustment) {
      if (normalizedReason.length < 3)
        return 'El motivo es obligatorio en un ajuste (mínimo 3 caracteres).';
      if (normalizedReason.length > 300) return 'El motivo no puede superar 300 caracteres.';
      if (/[<>]/.test(normalizedReason)) return 'El motivo no puede contener HTML.';
    } else if (normalizedReason) {
      if (normalizedReason.length < 3) return 'El motivo debe tener al menos 3 caracteres.';
      if (normalizedReason.length > 300) return 'El motivo no puede superar 300 caracteres.';
      if (/[<>]/.test(normalizedReason)) return 'El motivo no puede contener HTML.';
    }
    return null;
  }

  function buildBody(): CreateStockMovementRequest {
    const body: CreateStockMovementRequest = {
      type: isAdjustment ? adjustmentDirection : KIND_TYPE[kind],
      quantity: quantity.trim(),
    };
    // Solo ADMIN envía fecha; EMPLOYEE la omite y el backend usa hoy.
    if (showDate && effectiveDate) body.effectiveDate = effectiveDate;
    if (showDestination && destinationId) body.destinationId = destinationId;
    const normalizedReason = normalizeText(reason);
    if (normalizedReason) body.reason = normalizedReason;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setErrorMessage(problem);
      return;
    }
    // Ajustes: paso extra de confirmación (con saldo actual y cantidad).
    if (isAdjustment && !confirmStep) {
      setErrorMessage(null);
      setConfirmStep(true);
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        await onConfirm(buildBody());
      } catch (error) {
        if (isSessionExpired(error)) {
          onSessionExpired();
          return;
        }
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (isSubmitting) return;
    if (isAdjustment && confirmStep) {
      setConfirmStep(false);
      return;
    }
    onCancel();
  }

  const submitting = isSubmitting;
  const directionLabel = MOVEMENT_LABEL[adjustmentDirection];

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={handleCancel}
      closeDisabled={submitting}
    >
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          {KIND_TITLE[kind]}
        </h2>
        <p id={descriptionId} className="dialog__description">
          Producto: <strong>{item.name}</strong> (saldo actual: {item.currentQuantity} {item.unit}).{' '}
          {KIND_INTRO[kind]}
        </p>

        {kind === 'consumption' ? (
          <p className="notice notice--warning">
            <span aria-hidden="true">⚠️ </span>
            Este movimiento reduce el saldo disponible del producto.
          </p>
        ) : null}

        {isAdjustment ? (
          <p className="notice notice--warning">
            Los ajustes corrigen el inventario a mano y quedan trazados en el historial. No son
            ingresos ni consumos reales.
          </p>
        ) : null}

        {!confirmStep ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-quantity`}>
                Cantidad
              </label>
              <input
                id={`${titleId}-quantity`}
                className="field__input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={`En ${item.unit}`}
                value={quantity}
                disabled={submitting}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setErrorMessage(null);
                }}
              />
            </div>

            {isAdjustment ? (
              <fieldset className="choice-list" disabled={submitting}>
                <legend className="field__label">Tipo de ajuste</legend>
                <label className="choice">
                  <input
                    type="radio"
                    name={`${titleId}-direction`}
                    value="ADJUSTMENT_INCREASE"
                    checked={adjustmentDirection === 'ADJUSTMENT_INCREASE'}
                    onChange={() => setAdjustmentDirection('ADJUSTMENT_INCREASE')}
                  />
                  <span aria-hidden="true">⬆️ </span>
                  <span>Aumentar existencias</span>
                </label>
                <label className="choice">
                  <input
                    type="radio"
                    name={`${titleId}-direction`}
                    value="ADJUSTMENT_DECREASE"
                    checked={adjustmentDirection === 'ADJUSTMENT_DECREASE'}
                    onChange={() => setAdjustmentDirection('ADJUSTMENT_DECREASE')}
                  />
                  <span aria-hidden="true">⬇️ </span>
                  <span>Disminuir existencias</span>
                </label>
              </fieldset>
            ) : null}

            {showDate ? (
              <div className="field">
                <label className="field__label" htmlFor={`${titleId}-date`}>
                  Fecha (opcional)
                </label>
                <input
                  id={`${titleId}-date`}
                  className="field__input"
                  type="date"
                  max={today}
                  value={effectiveDate}
                  disabled={submitting}
                  onChange={(event) => {
                    setEffectiveDate(event.target.value);
                    setErrorMessage(null);
                  }}
                />
                <p className="field__hint">
                  En blanco se registra con la fecha de hoy. Solo se aceptan fechas de hoy o
                  pasadas.
                </p>
              </div>
            ) : (
              <p className="field__hint">
                Se registrará con la fecha de hoy según la zona horaria del establecimiento.
              </p>
            )}

            {showDestination ? (
              <div className="field">
                <label className="field__label" htmlFor={`${titleId}-destination`}>
                  Destino (opcional)
                </label>
                {destinations === null ? (
                  <p className="field__hint">Cargando destinos…</p>
                ) : destinations.length === 0 ? (
                  <p className="field__hint">
                    No hay destinos de consumo cargados. Puedes registrar el consumo sin elegir
                    destino.
                  </p>
                ) : (
                  <select
                    id={`${titleId}-destination`}
                    className="field__input"
                    value={destinationId}
                    disabled={submitting}
                    onChange={(event) => {
                      setDestinationId(event.target.value);
                      setErrorMessage(null);
                    }}
                  >
                    <option value="">Sin destino</option>
                    {destinations.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : null}

            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-reason`}>
                Motivo {isAdjustment ? '(obligatorio)' : '(opcional)'}
              </label>
              <input
                id={`${titleId}-reason`}
                className="field__input"
                type="text"
                maxLength={300}
                autoComplete="off"
                value={reason}
                disabled={submitting}
                onChange={(event) => {
                  setReason(event.target.value);
                  setErrorMessage(null);
                }}
              />
            </div>
          </>
        ) : (
          <div className="stock-confirm" role="group" aria-label="Confirmar ajuste">
            <h3 className="stock-confirm__title">Confirmá el ajuste</h3>
            <dl className="stock-confirm__list">
              <div>
                <dt>Tipo</dt>
                <dd>{directionLabel}</dd>
              </div>
              <div>
                <dt>
                  Cantidad a {adjustmentDirection === 'ADJUSTMENT_DECREASE' ? 'descontar' : 'sumar'}
                </dt>
                <dd>
                  {quantity.trim()} {item.unit}
                </dd>
              </div>
              <div>
                <dt>Saldo actual</dt>
                <dd>
                  {item.currentQuantity} {item.unit}
                </dd>
              </div>
              {normalizeText(reason) ? (
                <div>
                  <dt>Motivo</dt>
                  <dd>{normalizeText(reason)}</dd>
                </div>
              ) : null}
            </dl>
            <p className="field__hint">
              El backend aplicará la corrección de forma atómica sobre el saldo vigente al momento
              de procesarla.
            </p>
          </div>
        )}

        <div aria-live="assertive" className="live-status live-status--start">
          {submitting ? <span role="status">Registrando…</span> : null}
          {errorMessage ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {errorMessage}
            </span>
          ) : null}
        </div>

        <div className="dialog__actions">
          <Button variant="secondary" onClick={handleCancel} disabled={submitting}>
            {isAdjustment && confirmStep ? 'Volver' : 'Cancelar'}
          </Button>
          <Button type="submit" loading={submitting}>
            {isAdjustment
              ? confirmStep
                ? 'Confirmar ajuste'
                : 'Revisar ajuste'
              : 'Registrar movimiento'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Fecha local del navegador para la validación inmediata; el backend vuelve a decidir con BUSINESS_TIME_ZONE. */
function localCalendarDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
