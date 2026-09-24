import { useId } from 'react';
import type { AdminUserListItem } from '../../api/adminTypes';
import type { UserStatus } from '../../api/types';
import { getRoleLabel } from '../../auth/userDisplay';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import type { BadgeTone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { ButtonVariant } from '../../components/ui/buttonStyles';
import { KeyIcon } from '../../components/ui/icons';
import {
  getAllowedStatusTransitions,
  getStatusLabel,
  getTransitionActionLabel,
  statusChangeRevokesSessions,
} from './userStatusTransitions';

interface AdminUserRowProps {
  user: AdminUserListItem;
  isSelf: boolean;
  /** Verdadero cuando esta acción de cambio de estado dejaría al sistema sin ningún ADMIN activo — el backend también lo rechaza, esto solo evita ofrecerlo. */
  wouldSelfLockout: boolean;
  onActivate: (user: AdminUserListItem) => void;
  onResetPin: (user: AdminUserListItem) => void;
  onChangeStatus: (user: AdminUserListItem, nextStatus: UserStatus) => void;
}

/** Tono de cada estado — siempre acompañado de su etiqueta en español. */
const STATUS_TONE: Record<UserStatus, BadgeTone> = {
  PENDING_ACTIVATION: 'info',
  ACTIVE: 'positive',
  SUSPENDED: 'warning',
  DEACTIVATED: 'danger',
};

/** Jerarquía de la acción que lleva a cada estado: cortar el acceso es destructivo. */
const TRANSITION_VARIANT: Record<UserStatus, ButtonVariant> = {
  PENDING_ACTIVATION: 'ghost', // nunca se ofrece (ninguna transición real apunta acá)
  ACTIVE: 'primary',
  SUSPENDED: 'secondary',
  DEACTIVATED: 'danger',
};

const SELF_LOCKOUT_MESSAGE = 'No podés dejar el sistema sin ningún administrador activo.';

export function AdminUserRow({
  user,
  isSelf,
  wouldSelfLockout,
  onActivate,
  onResetPin,
  onChangeStatus,
}: AdminUserRowProps) {
  const lockoutHintId = useId();
  const displayName = user.employee?.displayName ?? user.username;
  const transitions = getAllowedStatusTransitions(user.status);
  const isAdminAccount = user.role === 'ADMIN' && !user.employee;

  const isLockedOut = (nextStatus: UserStatus) =>
    isSelf && user.role === 'ADMIN' && statusChangeRevokesSessions(nextStatus) && wouldSelfLockout;
  const showLockoutHint = transitions.some(isLockedOut);

  return (
    <li className="admin-user">
      <div className="admin-user__identity">
        {/* El listado administrativo no incluye `colorHex` (ver api/adminTypes.ts): avatar neutro. */}
        <Avatar name={displayName} variant={isAdminAccount ? 'admin' : 'person'} />
        <div className="admin-user__text">
          <p className="admin-user__name">
            <span>{displayName}</span>
            {isSelf ? <Badge tone="neutral">Tu cuenta</Badge> : null}
          </p>
          <p className="admin-user__username">@{user.username}</p>
          {isAdminAccount ? <p className="admin-user__hint">Sin persona vinculada</p> : null}
        </div>
      </div>

      <div className="admin-user__badges">
        <Badge tone={user.role === 'ADMIN' ? 'earth' : 'neutral'}>{getRoleLabel(user.role)}</Badge>
        <Badge tone={STATUS_TONE[user.status]} dot>
          {getStatusLabel(user.status)}
        </Badge>
      </div>

      <div className="admin-user__actions">
        {user.status === 'PENDING_ACTIVATION' ? (
          <Button size="sm" icon={<KeyIcon size="sm" />} onClick={() => onActivate(user)}>
            Activar y asignar PIN
          </Button>
        ) : null}

        {user.status === 'ACTIVE' ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<KeyIcon size="sm" />}
            onClick={() => onResetPin(user)}
          >
            Cambiar PIN
          </Button>
        ) : null}

        {transitions.map((nextStatus) => {
          const disabledBySelfLockout = isLockedOut(nextStatus);
          return (
            <Button
              key={nextStatus}
              size="sm"
              variant={TRANSITION_VARIANT[nextStatus]}
              disabled={disabledBySelfLockout}
              title={disabledBySelfLockout ? SELF_LOCKOUT_MESSAGE : undefined}
              aria-describedby={disabledBySelfLockout ? lockoutHintId : undefined}
              onClick={() => onChangeStatus(user, nextStatus)}
            >
              {getTransitionActionLabel(nextStatus)}
            </Button>
          );
        })}

        {showLockoutHint ? (
          <p className="admin-user__lockout-hint" id={lockoutHintId}>
            {SELF_LOCKOUT_MESSAGE}
          </p>
        ) : null}
      </div>
    </li>
  );
}
