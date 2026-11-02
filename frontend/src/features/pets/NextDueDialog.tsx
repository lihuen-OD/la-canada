import { useId, useState } from 'react';
import { ApiError } from '../../api/httpClient';
import { updatePetRecordNextDue } from '../../api/petsApi';
import type { MedicalRecordType } from '../../api/petTypes';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { humanError, isSessionExpired } from './petErrors';
import { RECORD_TAG_LABEL, formatDate, nextDay } from './petLabels';
import { usePetsCache } from './usePetsCache';

interface NextDueDialogProps {
  petId: string;
  record: { id: string; type: MedicalRecordType; recordDate: string };
  /** Fecha programada actual; vacía para completarla en un registro anterior. */
  current: string | null;
  onClose: () => void;
  onSessionExpired: () => void;
}

/**
 * Completar o corregir la próxima fecha (ADMIN y EMPLOYEE, sobre registros de
 * cualquier autor): acción acotada y auditada que no toca el resto del
 * registro. El backend valida que sea posterior a la atención y, con la fecha
 * que se mostró (`current`), que nadie la haya cambiado mientras tanto (409).
 * Guardar la misma fecha no envía nada.
 */
export function NextDueDialog({
  petId,
  record,
  current,
  onClose,
  onSessionExpired,
}: NextDueDialogProps) {
  const fieldId = useId();
  const [value, setValue] = useState(current ?? '');
  const { afterRecordChange } = usePetsCache();
  const minDate = nextDay(record.recordDate);
  return (
    <ConfirmDialog
      title={current ? 'Corregir fecha programada' : 'Completar fecha programada'}
      description={
        <>
          {RECORD_TAG_LABEL[record.type]} del {formatDate(record.recordDate)}. Solo cambia la fecha
          de la próxima aplicación o control; el resto del registro se conserva.
          <span className="field pet-due__field">
            <label className="field__label" htmlFor={fieldId}>
              Fecha de próxima aplicación o control
            </label>
            <input
              id={fieldId}
              className="field__input"
              type="date"
              min={minDate}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </span>
        </>
      }
      confirmLabel="Guardar fecha"
      onCancel={onClose}
      onConfirm={async () => {
        if (!value) throw new ApiError(400, 'Elegí la fecha.', 'VALIDATION_ERROR');
        if (value === current) {
          onClose();
          return;
        }
        try {
          await updatePetRecordNextDue(petId, record.id, value, current);
        } catch (caught) {
          if (isSessionExpired(caught)) {
            onClose();
            onSessionExpired();
            return;
          }
          // Otra persona la corrigió, la anuló o registró la atención: se
          // actualiza lo que se ve detrás del diálogo, sin reenviar nada.
          if (caught instanceof ApiError && caught.status === 409) afterRecordChange(petId);
          throw humanError(caught);
        }
        afterRecordChange(petId);
        onClose();
      }}
    />
  );
}
