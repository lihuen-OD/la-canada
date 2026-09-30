import { Link } from 'react-router-dom';
import type { PetDueItem } from '../../api/petTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import {
  DUE_STATUS_LABEL,
  DUE_STATUS_TONE,
  RECORD_TAG_LABEL,
  dueRelativeText,
  formatDate,
  fulfillActionLabel,
} from './petLabels';

interface PetDueRowProps {
  item: PetDueItem;
  /** En 📅 Vencimientos se muestra la mascota (en la ficha, no hace falta). */
  showPet?: boolean;
  /** Solo si la mascota admite registros nuevos y el pendiente sigue abierto. */
  onRegister?: () => void;
  /** Solo ADMIN: completar o corregir la fecha programada. */
  onEditDate?: () => void;
}

/**
 * Una atención programada: tipo y descripción, fecha de la atención original,
 * fecha programada, estado (backend) y tiempo restante o transcurrido, y
 * «Registrar aplicación / control». Mismas clases del historial clínico.
 */
export function PetDueRow({ item, showPet = false, onRegister, onEditDate }: PetDueRowProps) {
  const { record, nextDue, pet } = item;
  const label = fulfillActionLabel(record.type);
  return (
    <li className={`pet-due pet-due--${nextDue.status.toLowerCase()}`}>
      <div className="pet-history__head">
        <span className="pet-history__tag">{RECORD_TAG_LABEL[record.type]}</span>
        {showPet ? (
          <Link to={`/pets/${pet.id}`} className="pet-due__pet">
            <span aria-hidden="true">{pet.icon} </span>
            {pet.name}
          </Link>
        ) : null}
        <Badge tone={DUE_STATUS_TONE[nextDue.status]}>{DUE_STATUS_LABEL[nextDue.status]}</Badge>
      </div>
      {record.description ? <p className="pet-history__text">{record.description}</p> : null}
      <p className="pet-due__dates">
        <span>Atención: {formatDate(record.recordDate)}</span>
        <span>
          Programada: <strong>{formatDate(nextDue.date)}</strong>
        </span>
        <span className="pet-due__relative">{dueRelativeText(nextDue)}</span>
      </p>
      {onRegister || onEditDate ? (
        <div className="pet-due__actions">
          {onRegister ? (
            <Button
              size="sm"
              onClick={onRegister}
              aria-label={`${label}: ${RECORD_TAG_LABEL[record.type]}${showPet ? ` de ${pet.name}` : ''}, programada para el ${formatDate(nextDue.date)}`}
            >
              {label}
            </Button>
          ) : null}
          {onEditDate ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onEditDate}
              aria-label={`Corregir la fecha programada del ${formatDate(nextDue.date)}`}
            >
              Corregir fecha
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
