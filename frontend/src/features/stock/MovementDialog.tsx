import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/httpClient';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  CreateStockMovementRequest,
  StockItem,
  StockMovementMutationResponse,
} from '../../api/stockTypes';
import type { SystemRole } from '../../api/types';
import { fetchStockDestinations } from '../../api/stockApi';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorMessageOf, isSessionExpired, isStockConflict, stockErrorCode } from './stockErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { MOVEMENT_LABEL } from './stockLabels';
import { useStockCache, useSubmitStockMovement } from './useStockCache';

export type MovementKind = 'income' | 'consumption' | 'adjustment';
/** `movement`: modal unificado Consumo/Ingreso del prototipo; `adjustment`: ajuste ADMIN aparte. */
export type MovementDialogMode = 'movement' | 'adjustment';
type EverydayType = 'CONSUMPTION' | 'INCOME';

/**
 * Misma representación decimal estricta que el backend
 * (`stockQuantityTextSchema`): hasta 8 enteros y 2 decimales, positivo.
 */
const QUANTITY_PATTERN = /^(?:0\.\d{1,2}|[1-9]\d{0,7}(?:\.\d{1,2})?)$/;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Estado del último envío fallido: `retry` (sin respuesta del servidor — el
 * reintento reutiliza la MISMA clave) o `pending` (el backend todavía
 * resuelve esa clave: el formulario queda bloqueado y solo se puede
 * consultar con la misma clave, nunca crear otra operación).
 */
type SubmitPhase = 'idle' | 'retry' | 'pending';

interface MovementDialogProps {
  item: StockItem;
  mode: MovementDialogMode;
  /** Tipo inicial del modal unificado (el prototipo abría en Consumo; Compras abre en Ingreso). */
  initialType?: EverydayType;
  /** Rol real de `useAuth().user`; nunca se infiere desde el tipo de movimiento. */
  role: SystemRole | undefined;
  onCancel: () => void;
  /** Éxito definitivo (creación o replay `201`, misma experiencia). */
  onSuccess: (response: StockMovementMutationResponse, kind: MovementKind) => void;
  onSessionExpired: () => void;
}

/**
 * Modal "Registrar movimiento" del prototipo (`mo-consumo`, docs/BUSINESS_RULES.md
 * §8): conmutador 📤 Consumo / Salida · 📥 Ingreso / Entrada, cantidad, fecha
 * (hoy o pasada, para todos; nunca futura), "¿Quién consumió?", destino
 * opcional en todo movimiento y motivo. La persona la elige solo un ADMIN
 * (empleado activo o "🔐 Administrador"); un EMPLOYEE queda fijado a sí
 * mismo y no envía `employeeId`. Nunca envía `stockItemId`. El ajuste es un
 * modo aparte, exclusivo de ADMIN, con motivo obligatorio y un paso extra de
 * confirmación — sin calcular un saldo resultante.
 *
 * Idempotencia (Etapa 5C.2): cada intención lleva su `Idempotency-Key`
 * (`IdempotencyIntent`, solo en memoria de este diálogo). El mismo envío
 * — doble clic, "Reintentar" tras una falla de red, "Consultar estado" de
 * un registro pendiente o el reintento central tras refresh — reutiliza la
 * clave; cambiar cualquier campo la descarta y el próximo envío es otra
 * operación. Cancelar o cerrar también la descarta (vive en el componente).
 */
export function MovementDialog({
  item,
  mode,
  initialType = 'CONSUMPTION',
  role,
  onCancel,
  onSuccess,
  onSessionExpired,
}: MovementDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const isAdmin = role === 'ADMIN';
  const { user } = useAuth();
  const [today] = useState(localCalendarDate);
  const [movementType, setMovementType] = useState<EverydayType>(initialType);
  const [quantity, setQuantity] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  /** Solo ADMIN: '' = "🔐 Administrador" (sin persona); si no, el id del empleado. */
  const [personId, setPersonId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [reason, setReason] = useState('');
  const [adjustmentDirection, setAdjustmentDirection] = useState<
    'ADJUSTMENT_INCREASE' | 'ADJUSTMENT_DECREASE'
  >('ADJUSTMENT_INCREASE');
  const [confirmStep, setConfirmStep] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const { isSubmitting, run } = useSubmitGuard();
  const { userId, enabled } = useSessionScope();
  const intentRef = useRef(new IdempotencyIntent());
  const submitMovement = useSubmitStockMovement();
  const { afterMovement } = useStockCache();

  // Destinos ACTIVOS (opcionales en todo movimiento) y, solo para ADMIN, las
  // personas elegibles. Catálogos casi estáticos: se reutilizan (Etapa 5P).
  const destinationsQuery = useQuery({
    queryKey: queryKeys.stock.destinations(userId, 'active'),
    queryFn: () => fetchStockDestinations('active'),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const employeesQuery = useQuery({
    queryKey: queryKeys.tasks.employees(userId),
    queryFn: fetchTaskEmployees,
    enabled: enabled && isAdmin,
    staleTime: STALE_TIME.catalog,
  });
  const catalogExpired =
    isSessionExpired(destinationsQuery.error) || isSessionExpired(employeesQuery.error);
  useEffect(() => {
    if (catalogExpired) onSessionExpired();
  }, [catalogExpired, onSessionExpired]);
  const vehicles = (destinationsQuery.data?.destinations ?? []).filter(
    (destination) => destination.type === 'VEHICLE',
  );
  const sectors = (destinationsQuery.data?.destinations ?? []).filter(
    (destination) => destination.type === 'SECTOR',
  );
  /** Un cambio semántico del formulario es otra intención: la clave anterior se descarta. */
  function changeField(apply: () => void): void {
    apply();
    intentRef.current.discard();
    setPhase('idle');
    setErrorMessage(null);
  }

  const isAdjustment = mode === 'adjustment';
  const locked = phase === 'pending';
  const kind: MovementKind = isAdjustment
    ? 'adjustment'
    : movementType === 'INCOME'
      ? 'income'
      : 'consumption';

  function validate(): string | null {
    const normalizedQuantity = quantity.trim();
    if (!normalizedQuantity) return 'La cantidad es obligatoria.';
    if (!QUANTITY_PATTERN.test(normalizedQuantity))
      return 'La cantidad debe ser un número positivo con hasta 2 decimales.';
    if (/^0+(\.0+)?$/.test(normalizedQuantity)) return 'La cantidad debe ser mayor a cero.';

    if (!effectiveDate) return 'Seleccioná la fecha.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))
      return 'La fecha debe tener formato YYYY-MM-DD.';
    if (effectiveDate > today) return 'La fecha no puede ser futura.';

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
      type: isAdjustment ? adjustmentDirection : movementType,
      quantity: quantity.trim(),
      effectiveDate,
    };
    if (destinationId) body.destinationId = destinationId;
    // Solo ADMIN elige persona (null = Administrador); EMPLOYEE nunca la envía.
    if (isAdmin) body.employeeId = personId || null;
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
      const body = buildBody();
      const key = intentRef.current.keyFor(intentFingerprint(item.id, body));
      try {
        const response = await submitMovement(item.id, body, key);
        intentRef.current.discard();
        onSuccess(response, kind);
      } catch (error) {
        if (isSessionExpired(error)) {
          onSessionExpired();
          return;
        }
        const code = stockErrorCode(error);
        if (code === 'IDEMPOTENCY_RECORD_PENDING') {
          // Misma clave conservada: consultar nunca crea otra operación.
          setPhase('pending');
        } else if (code === 'IDEMPOTENCY_KEY_CONFLICT' || code === 'IDEMPOTENCY_KEY_INVALID') {
          // Nueva intención en el próximo envío.
          intentRef.current.discard();
          setPhase('idle');
        } else if (!(error instanceof ApiError) || error.status >= 500) {
          // Sin respuesta útil (red, 502/503 de un proxy): pudo haberse
          // registrado o no. "Reintentar" reenvía la MISMA clave y el backend
          // responde el replay si ya existía — nunca un segundo movimiento.
          setPhase('retry');
        } else {
          // Rechazo definitivo de negocio: la transacción se revirtió y la
          // clave quedó libre en el backend; un nuevo envío es otra intención.
          intentRef.current.discard();
          setPhase('idle');
          if (isStockConflict(error)) afterMovement(item.id);
        }
        setErrorMessage(
          error instanceof ApiError && error.status < 500
            ? errorMessageOf(error)
            : 'No pudimos confirmar el registro. Podés reintentar: el reintento usa el mismo envío y no se registrará dos veces.',
        );
      }
    });
  }

  function handleCancel(): void {
    if (isSubmitting) return;
    if (isAdjustment && confirmStep && !locked) {
      setConfirmStep(false);
      return;
    }
    onCancel();
  }

  const submitting = isSubmitting;
  const fieldsDisabled = submitting || locked;
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
          {isAdjustment ? (
            <>
              <span aria-hidden="true">⚙️ </span>Ajustar stock
            </>
          ) : (
            'Registrar movimiento'
          )}
        </h2>
        <p id={descriptionId} className="dialog__description">
          Ítem: <strong>{item.name}</strong> · Stock actual: {item.currentQuantity} {item.unit}
          {isAdjustment
            ? '. Corrección de inventario exclusiva de administradores; queda en el historial con su motivo.'
            : ''}
        </p>

        {!isAdjustment && !confirmStep ? (
          <div className="stock-movetype" role="group" aria-label="Tipo de movimiento">
            <button
              type="button"
              className={`stock-movetype__btn${movementType === 'CONSUMPTION' ? ' is-consumption' : ''}`}
              aria-pressed={movementType === 'CONSUMPTION'}
              disabled={fieldsDisabled}
              onClick={() => changeField(() => setMovementType('CONSUMPTION'))}
            >
              <span aria-hidden="true">📤 </span>Consumo / Salida
            </button>
            <button
              type="button"
              className={`stock-movetype__btn${movementType === 'INCOME' ? ' is-income' : ''}`}
              aria-pressed={movementType === 'INCOME'}
              disabled={fieldsDisabled}
              onClick={() => changeField(() => setMovementType('INCOME'))}
            >
              <span aria-hidden="true">📥 </span>Ingreso / Entrada
            </button>
          </div>
        ) : null}

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
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  changeField(() => setQuantity(next));
                }}
              />
            </div>

            {isAdjustment ? (
              <fieldset className="choice-list" disabled={fieldsDisabled}>
                <legend className="field__label">Tipo de ajuste</legend>
                <label className="choice">
                  <input
                    type="radio"
                    name={`${titleId}-direction`}
                    value="ADJUSTMENT_INCREASE"
                    checked={adjustmentDirection === 'ADJUSTMENT_INCREASE'}
                    onChange={() =>
                      changeField(() => setAdjustmentDirection('ADJUSTMENT_INCREASE'))
                    }
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
                    onChange={() =>
                      changeField(() => setAdjustmentDirection('ADJUSTMENT_DECREASE'))
                    }
                  />
                  <span aria-hidden="true">⬇️ </span>
                  <span>Disminuir existencias</span>
                </label>
              </fieldset>
            ) : null}

            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-date`}>
                Fecha
              </label>
              <input
                id={`${titleId}-date`}
                className="field__input"
                type="date"
                max={today}
                value={effectiveDate}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  changeField(() => setEffectiveDate(next));
                }}
              />
              <p className="field__hint">Hoy o una fecha pasada; nunca futura.</p>
            </div>

            <div className="field">
              {isAdmin ? (
                <>
                  <label className="field__label" htmlFor={`${titleId}-person`}>
                    ¿Quién consumió?
                  </label>
                  <select
                    id={`${titleId}-person`}
                    className="field__input"
                    value={personId}
                    disabled={fieldsDisabled}
                    onChange={(event) => {
                      const next = event.target.value;
                      changeField(() => setPersonId(next));
                    }}
                  >
                    <option value="">🔐 Administrador</option>
                    {(employeesQuery.data?.employees ?? []).map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.displayName}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <p className="field__label">¿Quién consumió?</p>
                  <p className="field__hint">
                    {user?.employee?.displayName ?? 'Vos'} (tu sesión; no se puede cambiar).
                  </p>
                </>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-destination`}>
                Destino
              </label>
              <select
                id={`${titleId}-destination`}
                className="field__input"
                value={destinationId}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  changeField(() => setDestinationId(next));
                }}
              >
                <option value="">— Sin destino específico —</option>
                {vehicles.length ? (
                  <optgroup label="🚗 Vehículos y máquinas">
                    {vehicles.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {sectors.length ? (
                  <optgroup label="🏡 Sectores">
                    {sectors.map((destination) => (
                      <option key={destination.id} value={destination.id}>
                        {destination.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              {destinationsQuery.isPending ? (
                <p className="field__hint" role="status">
                  Cargando destinos…
                </p>
              ) : !vehicles.length && !sectors.length ? (
                <p className="field__hint">
                  {destinationsQuery.isError
                    ? 'No pudimos cargar los destinos. Podés registrar el movimiento sin destino.'
                    : 'Todavía no hay destinos cargados. Podés registrar el movimiento sin destino.'}
                </p>
              ) : null}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-reason`}>
                Motivo / Observación {isAdjustment ? '(obligatorio)' : '(opcional)'}
              </label>
              <input
                id={`${titleId}-reason`}
                className="field__input"
                type="text"
                maxLength={300}
                autoComplete="off"
                value={reason}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  changeField(() => setReason(next));
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
          {submitting ? (
            <span role="status">{locked ? 'Consultando…' : 'Registrando…'}</span>
          ) : null}
          {errorMessage ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {errorMessage}
            </span>
          ) : null}
        </div>

        {locked ? (
          <p className="field__hint">
            Podés consultar de nuevo o actualizar el inventario para ver si el saldo ya cambió.{' '}
            <Button size="sm" variant="ghost" onClick={() => afterMovement(item.id)}>
              Actualizar inventario
            </Button>
          </p>
        ) : null}

        <div className="dialog__actions">
          <Button variant="secondary" onClick={handleCancel} disabled={submitting}>
            {isAdjustment && confirmStep && !locked ? 'Volver' : 'Cancelar'}
          </Button>
          <Button type="submit" loading={submitting}>
            {locked
              ? 'Consultar estado'
              : phase === 'retry'
                ? 'Reintentar'
                : isAdjustment
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
