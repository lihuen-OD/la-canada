import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { activateUser, changeUserStatus, fetchAdminUsers, resetUserPin } from '../../api/adminApi';
import type { AdminUserListItem } from '../../api/adminTypes';
import type { UserStatus } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { AdminUserRow } from './AdminUserRow';
import { PinDialog } from './PinDialog';
import { ConfirmDialog } from './ConfirmDialog';
import {
  getStatusLabel,
  getTransitionActionLabel,
  statusChangeRevokesSessions,
} from './userStatusTransitions';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'loaded'; users: AdminUserListItem[] };

type DialogState =
  | { type: 'none' }
  | { type: 'activate'; user: AdminUserListItem }
  | { type: 'reset'; user: AdminUserListItem }
  | { type: 'status'; user: AdminUserListItem; nextStatus: UserStatus };

/**
 * Pantalla administrativa de usuarios — consume `GET /admin/users` tal
 * cual (`{ users, pagination }`), nunca inventa personas ni completa la
 * lista con fixtures. El acceso ya está gateado por `ProtectedRoute` +
 * `RequireRole` (ver `routes/AppRoutes.tsx`); acá no se repite esa
 * comprobación, pero el backend igual la exige de forma independiente en
 * cada request (`requireAuth` + `requireRole('ADMIN')`).
 */
export function AdminUsersScreen() {
  const { user: currentUser, logout } = useAuth();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchAdminUsers()
      .then((response) => setState({ status: 'loaded', users: response.users }))
      .catch(() => setState({ status: 'error' }));
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  const closeDialog = useCallback(() => setDialog({ type: 'none' }), []);

  async function afterMutation(targetId: string, revokesSelfSession: boolean, message: string) {
    if (revokesSelfSession && currentUser && targetId === currentUser.id) {
      // El propio ADMIN acaba de revocar su propia sesión (cambio de PIN
      // propio, o auto-suspensión/deshabilitación) — el backend ya la
      // revocó de verdad del lado del servidor. `logout()` reutiliza el
      // mismo mecanismo de siempre (limpia el token en memoria, incrementa
      // la época para que un refresh tardío no vuelva a autenticar, y
      // lleva al login) — nunca se intenta seguir usando la sesión ni
      // refrescarla.
      closeDialog();
      await logout();
      return;
    }
    closeDialog();
    setSuccessMessage(message);
    retry();
  }

  const users = state.status === 'loaded' ? state.users : [];
  const activeAdminIds = new Set(
    users.filter((u) => u.role === 'ADMIN' && u.status === 'ACTIVE').map((u) => u.id),
  );

  function wouldSelfLockout(userId: string): boolean {
    if (!currentUser || userId !== currentUser.id) return false;
    const otherActiveAdmins = [...activeAdminIds].filter((id) => id !== userId);
    return otherActiveAdmins.length === 0;
  }

  return (
    <main className="admin-users">
      <div className="admin-users__header">
        <Link to="/" className="admin-users__back">
          ← Volver
        </Link>
        <h1 className="admin-users__title">Usuarios</h1>
      </div>

      <div aria-live="polite" className="admin-users__feedback">
        {successMessage ? <p role="status">{successMessage}</p> : null}
      </div>

      {state.status === 'loading' ? (
        <p role="status" aria-live="polite">
          Cargando usuarios…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div role="alert">
          <p>No pudimos cargar la lista de usuarios.</p>
          <button type="button" className="button button--primary" onClick={retry}>
            Reintentar
          </button>
        </div>
      ) : null}

      {state.status === 'loaded' && users.length === 0 ? (
        <p>Todavía no hay usuarios cargados.</p>
      ) : null}

      {state.status === 'loaded' && users.length > 0 ? (
        <ul className="admin-users__list" role="list">
          {users.map((user) => (
            <AdminUserRow
              key={user.id}
              user={user}
              isSelf={currentUser?.id === user.id}
              wouldSelfLockout={wouldSelfLockout(user.id)}
              onActivate={(target) => setDialog({ type: 'activate', user: target })}
              onResetPin={(target) => setDialog({ type: 'reset', user: target })}
              onChangeStatus={(target, nextStatus) =>
                setDialog({ type: 'status', user: target, nextStatus })
              }
            />
          ))}
        </ul>
      ) : null}

      {dialog.type === 'activate' ? (
        <PinDialog
          mode="activate"
          targetDisplayName={dialog.user.employee?.displayName ?? dialog.user.username}
          isSelf={currentUser?.id === dialog.user.id}
          onCancel={closeDialog}
          onSubmit={async (pin) => {
            await activateUser(dialog.user.id, pin);
            await afterMutation(dialog.user.id, false, 'Usuario activado correctamente.');
          }}
        />
      ) : null}

      {dialog.type === 'reset' ? (
        <PinDialog
          mode="reset"
          targetDisplayName={dialog.user.employee?.displayName ?? dialog.user.username}
          isSelf={currentUser?.id === dialog.user.id}
          onCancel={closeDialog}
          onSubmit={async (pin) => {
            await resetUserPin(dialog.user.id, pin);
            await afterMutation(dialog.user.id, true, 'PIN actualizado correctamente.');
          }}
        />
      ) : null}

      {dialog.type === 'status' ? (
        <ConfirmDialog
          title={`${getTransitionActionLabel(dialog.nextStatus)} a ${dialog.user.employee?.displayName ?? dialog.user.username}`}
          description={
            <>
              Esta persona pasará de <strong>{getStatusLabel(dialog.user.status)}</strong> a{' '}
              <strong>{getStatusLabel(dialog.nextStatus)}</strong>.{' '}
              {statusChangeRevokesSessions(dialog.nextStatus)
                ? 'Dejará de poder ingresar y se cerrarán todas sus sesiones activas.'
                : 'Va a poder volver a ingresar con su PIN existente.'}
              {statusChangeRevokesSessions(dialog.nextStatus) && currentUser?.id === dialog.user.id
                ? ' Incluida tu propia sesión actual: volverás a la pantalla de login.'
                : ''}
            </>
          }
          confirmLabel={getTransitionActionLabel(dialog.nextStatus)}
          onCancel={closeDialog}
          onConfirm={async () => {
            await changeUserStatus(dialog.user.id, dialog.nextStatus);
            await afterMutation(
              dialog.user.id,
              statusChangeRevokesSessions(dialog.nextStatus),
              'Estado actualizado correctamente.',
            );
          }}
        />
      ) : null}
    </main>
  );
}
