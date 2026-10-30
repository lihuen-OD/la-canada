import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LateCompletionBounds, PerformanceOccurrence } from '../../api/performanceTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { formatDate, formatDateRange, formatDateWithWeekday } from '../../utils/dateFormat';
import { errorMessageOf } from './dialogErrors';
import { FREQUENCY_LABEL } from './taskLabels';
import { useSubmitGuard } from './useSubmitGuard';

export type LateCompletionItem = PerformanceOccurrence & { lateCompletion: LateCompletionBounds };

interface LateCompletionDialogProps {
  item: LateCompletionItem;
  isAdmin: boolean;
  onCancel: () => void;
  onConfirm: (choice: { performedOn: string; employeeId?: string }) => Promise<void>;
}

/**
 * «Marcar como realizada» una obligación de Desempeño → Detalle que se hizo
 * y no se marcó (solo ✅ Tareas). Diaria: la fecha es la de la fila y solo se
 * confirma. Períodos más largos: se muestra el período y se pide el día real
 * en que se hizo, entre las fechas que admite el backend (nunca futuro), sin
 * preseleccionar ninguno. ADMIN elige explícitamente quién la realizó (sin
 * preselección); un EMPLOYEE la registra a su nombre. Sin motivo: es una
 * carga olvidada, no una corrección administrativa.
 */
export function LateCompletionDialog({
  item,
  isAdmin,
  onCancel,
  onConfirm,
}: LateCompletionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const bounds = item.lateCompletion;
  const daily = bounds.periodStart === bounds.periodEnd;
  const [performedOn, setPerformedOn] = useState(daily ? bounds.periodStart : '');
  const [employeeId, setEmployeeId] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const { userId, enabled } = useSessionScope();
  const people = useQuery({
    queryKey: queryKeys.tasks.employees(userId),
    queryFn: fetchTaskEmployees,
    enabled: enabled && isAdmin,
    staleTime: STALE_TIME.catalog,
  });

  const rangeText =
    bounds.earliest === bounds.latest
      ? formatDate(bounds.earliest)
      : `entre el ${formatDate(bounds.earliest)} y el ${formatDate(bounds.latest)}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!performedOn) {
      setErrorMessage(
        isAdmin ? 'Elegí la fecha en que se realizó.' : 'Elegí la fecha en que la realizaste.',
      );
      return;
    }
    if (performedOn < bounds.earliest || performedOn > bounds.latest) {
      setErrorMessage(`Elegí un día ${rangeText}.`);
      return;
    }
    if (isAdmin && !employeeId) {
      setErrorMessage('Elegí quién la realizó.');
      return;
    }
    void run(async () => {
      setErrorMessage(null);
      try {
        await onConfirm({ performedOn, ...(isAdmin ? { employeeId } : {}) });
      } catch (error) {
        setErrorMessage(errorMessageOf(error));
      }
    });
  }

  function handleCancel(): void {
    if (!isSubmitting) onCancel();
  }

  const question = daily
    ? isAdmin
      ? `¿Confirmás que “${item.description}” se realizó el ${formatDate(performedOn)}?`
      : `¿Confirmás que realizaste “${item.description}” el ${formatDate(performedOn)}?`
    : `“${item.description}” · ${FREQUENCY_LABEL[item.frequency]}`;

  return (
    <Modal
      titleId={titleId}
      descriptionId={descriptionId}
      onRequestClose={handleCancel}
      closeDisabled={isSubmitting}
    >
      <form className="dialog dialog--prototype" onSubmit={handleSubmit} noValidate>
        <h2 id={titleId} className="dialog__title">
          <span aria-hidden="true">✅ </span>Marcar como realizada
        </h2>
        <p id={descriptionId} className="dialog__description">
          {question}
        </p>

        {daily ? null : (
          <>
            <p className="late-completion__period">
              <span className="field__label">Período</span>
              {formatDateRange(bounds.periodStart, bounds.periodEnd)}
            </p>
            <div className="field">
              <label className="field__label" htmlFor={`${titleId}-performed-on`}>
                {isAdmin ? 'Fecha en que se realizó' : 'Fecha en que la realizaste'}
              </label>
              <input
                id={`${titleId}-performed-on`}
                className="field__input"
                type="date"
                min={bounds.earliest}
                max={bounds.latest}
                value={performedOn}
                required
                disabled={isSubmitting}
                aria-describedby={`${titleId}-performed-on-hint`}
                onChange={(event) => {
                  setPerformedOn(event.target.value);
                  setErrorMessage(null);
                }}
              />
              <p className="field__hint" id={`${titleId}-performed-on-hint`}>
                {performedOn
                  ? formatDateWithWeekday(performedOn)
                  : `El día real en que se hizo, ${rangeText}.`}
              </p>
            </div>
          </>
        )}

        {isAdmin ? (
          <fieldset className="choice-list" disabled={isSubmitting}>
            <legend className="field__label">¿Quién la realizó?</legend>
            {people.data ? (
              people.data.employees.map((employee) => (
                <label key={employee.id} className="choice">
                  <input
                    type="radio"
                    name={`${titleId}-employee`}
                    value={employee.id}
                    checked={employeeId === employee.id}
                    onChange={() => {
                      setEmployeeId(employee.id);
                      setErrorMessage(null);
                    }}
                  />
                  <Avatar name={employee.displayName} colorHex={employee.colorHex} size="sm" />
                  <span>{employee.displayName}</span>
                  {employee.id === item.assignedEmployeeId ? (
                    <span className="choice__hint">(responsable)</span>
                  ) : null}
                </label>
              ))
            ) : people.isError ? (
              <p role="alert" className="field__hint">
                No pudimos cargar las personas.{' '}
                <Button size="sm" variant="ghost" onClick={() => void people.refetch()}>
                  Reintentar
                </Button>
              </p>
            ) : (
              <p className="field__hint">Cargando personas…</p>
            )}
          </fieldset>
        ) : null}

        <p className="field__hint">
          Solo se registra este período; los demás no cambian. Queda constancia de que la
          registraste hoy.
        </p>

        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Registrando…</span> : null}
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
          <Button type="submit" loading={isSubmitting}>
            Confirmar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
