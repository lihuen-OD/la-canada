import type { AdminUserListItem } from '../../api/adminTypes';
import type { UserStatus } from '../../api/types';
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

const STATUS_BADGE_MODIFIER: Record<UserStatus, string> = {
  PENDING_ACTIVATION: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DEACTIVATED: 'deactivated',
};

export function AdminUserRow({
  user,
  isSelf,
  wouldSelfLockout,
  onActivate,
  onResetPin,
  onChangeStatus,
}: AdminUserRowProps) {
  const displayName = user.employee?.displayName ?? user.username;
  const transitions = getAllowedStatusTransitions(user.status);

  return (
    <li className="admin-user-row">
      <div className="admin-user-row__identity">
        <p className="admin-user-row__name">
          {displayName}
          {isSelf ? ' (vos)' : ''}
        </p>
        <p className="admin-user-row__username">@{user.username}</p>
        {user.role === 'ADMIN' && !user.employee ? (
          <p className="admin-user-row__hint">Sin persona vinculada</p>
        ) : null}
      </div>

      <div className="admin-user-row__badges">
        <span className={`badge badge--role-${user.role.toLowerCase()}`}>
          {user.role === 'ADMIN' ? 'Administrador' : 'Equipo'}
        </span>
        <span className={`badge badge--status-${STATUS_BADGE_MODIFIER[user.status]}`}>
          {getStatusLabel(user.status)}
        </span>
      </div>

      <div className="admin-user-row__actions">
        {user.status === 'PENDING_ACTIVATION' ? (
          <button type="button" className="button button--primary" onClick={() => onActivate(user)}>
            Activar y asignar PIN
          </button>
        ) : null}

        {user.status === 'ACTIVE' ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => onResetPin(user)}
          >
            Cambiar PIN
          </button>
        ) : null}

        {transitions.map((nextStatus) => {
          const disabledBySelfLockout =
            isSelf &&
            user.role === 'ADMIN' &&
            statusChangeRevokesSessions(nextStatus) &&
            wouldSelfLockout;
          return (
            <button
              key={nextStatus}
              type="button"
              className="button button--tertiary"
              disabled={disabledBySelfLockout}
              title={
                disabledBySelfLockout
                  ? 'No podés dejar el sistema sin ningún administrador activo.'
                  : undefined
              }
              onClick={() => onChangeStatus(user, nextStatus)}
            >
              {getTransitionActionLabel(nextStatus)}
            </button>
          );
        })}
      </div>
    </li>
  );
}
