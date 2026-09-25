import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { activateUser, changeUserStatus, fetchAdminUsers, resetUserPin } from '../../api/adminApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import type { AdminUserListItem } from '../../api/adminTypes';
import type { UserStatus } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { CheckCircleIcon } from '../../components/ui/icons';
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
 *
 * Datos (Etapa 5P): caché por sesión; volver a la pantalla muestra la lista
 * al instante y cada mutación invalida solo este listado.
 */
export function AdminUsersScreen() {
  const { user: currentUser, logout } = useAuth();
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' });
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { userId, enabled } = useSessionScope();
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(userId),
    queryFn: fetchAdminUsers,
    enabled,
  });
  const state: LoadState = usersQuery.data
    ? { status: 'loaded', users: usersQuery.data.users }
    : usersQuery.isError
      ? { status: 'error' }
      : { status: 'loading' };

  const load = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users(userId) });
  }, [queryClient, userId]);

  const retry = useCallback(() => {
    void usersQuery.refetch();
  }, [usersQuery]);

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
    // Refresco en segundo plano: el listado actual sigue visible hasta que
    // llega el nuevo, sin pasar por "Cargando…" (evita un salto de layout).
    load();
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
    <div className="admin-users">
      <PageHeader
        title="Usuarios"
        description="Activá cuentas, asigná el PIN de cada persona y gestioná su estado de acceso."
        refreshing={state.status === 'loaded' && usersQuery.isFetching}
      />

      <div aria-live="polite" className="admin-users__feedback">
        {successMessage ? (
          <p role="status" className="notice notice--positive">
            <CheckCircleIcon size="sm" />
            {successMessage}
          </p>
        ) : null}
      </div>

      {state.status === 'loading' ? (
        <Card>
          <LoadingState label="Cargando usuarios…" />
        </Card>
      ) : null}

      {state.status === 'error' ? (
        <Card>
          <ErrorState title="No pudimos cargar la lista de usuarios." onRetry={retry} />
        </Card>
      ) : null}

      {state.status === 'loaded' && users.length === 0 ? (
        <Card>
          <EmptyState title="Todavía no hay usuarios cargados." />
        </Card>
      ) : null}

      {state.status === 'loaded' && users.length > 0 ? (
        <section className="admin-users__table" aria-label="Usuarios del sistema">
          <div className="admin-users__panel">
            {/* Encabezados visuales de columna (solo en el layout de filas):
                cada fila ya expone rol y estado como texto, así que no se
                duplican para lectores de pantalla. */}
            <div className="admin-users__columns" aria-hidden="true">
              <span>Persona</span>
              <span>Rol y estado</span>
              <span>Acciones</span>
            </div>
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
          </div>
        </section>
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
          tone={statusChangeRevokesSessions(dialog.nextStatus) ? 'danger' : 'default'}
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
    </div>
  );
}
