import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { activateUser, resetUserPin } from '../../api/adminApi';
import { fetchEmployees, setEmployeeActive } from '../../api/moreApi';
import type { ManagedEmployee } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { PinDialog } from '../admin/PinDialog';
import { errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { EmployeeFormDialog } from './EmployeeFormDialog';
import { MoreBackLink } from './MoreBackLink';
import { TaskCalendar } from './TaskCalendar';
import { useMoreCache } from './useMoreCache';

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; employee?: ManagedEmployee }
  | { kind: 'status'; employee: ManagedEmployee }
  | { kind: 'pin'; employee: ManagedEmployee }
  | { kind: 'ownPin' };

/**
 * ⚙️ Configuración (`pg-config`, solo ADMIN): 👥 Personas, 👤 Datos del
 * equipo, 📅 Calendario de tareas, 🔐 Seguridad y 📱 Instalar como app. El
 * backend vuelve a exigir el rol en cada operación.
 */
export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const { afterEmployeeChange, afterAccountChange } = useMoreCache();
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [notice, setNotice] = useState<string | null>(null);
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const close = () => setDialog({ kind: 'none' });
  const query = useQuery({
    queryKey: queryKeys.more.employees(userId),
    queryFn: fetchEmployees,
    enabled,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  const employees = query.data?.employees ?? [];

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">⚙️ </span>Configuración
          </>
        }
        refreshing={Boolean(query.data) && query.isFetching}
        actions={<MoreBackLink />}
      />
      {notice ? (
        <p className="notice notice--positive" role="status">
          {notice}
        </p>
      ) : null}

      <Card
        title={
          <>
            <span aria-hidden="true">👥 </span>Personas
          </>
        }
        actions={
          <Button size="sm" onClick={() => setDialog({ kind: 'form' })}>
            + Agregar
          </Button>
        }
      >
        {!query.data ? (
          query.isError ? (
            <ErrorState
              title="No pudimos cargar las personas"
              titleAs="p"
              description={errorMessageOf(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <LoadingState label="Cargando personas…" />
          )
        ) : (
          <ul className="people-list" aria-label="Personas">
            {employees.map((employee) => (
              <li
                key={employee.id}
                className={employee.active ? 'person-row' : 'person-row is-inactive'}
              >
                <Avatar name={employee.displayName} colorHex={employee.colorHex} />
                <span className="person-row__body">
                  <span className="person-row__name">{employee.displayName}</span>
                  <span className="person-row__meta">
                    {employee.role}
                    {employee.active ? '' : ' · Inactiva'}
                  </span>
                  <span className="person-row__pin">
                    {employee.account?.hasPin ? '🔑 PIN asignado' : '⚠️ Sin PIN'}
                  </span>
                </span>
                <span className="person-row__actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Cambiar PIN de ${employee.displayName}`}
                    disabled={!employee.account || !employee.active}
                    onClick={() => setDialog({ kind: 'pin', employee })}
                  >
                    <span aria-hidden="true">🔑</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar a ${employee.displayName}`}
                    onClick={() => setDialog({ kind: 'form', employee })}
                  >
                    <span aria-hidden="true">✏️</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={employee.active ? 'danger' : 'secondary'}
                    onClick={() => setDialog({ kind: 'status', employee })}
                  >
                    {employee.active ? 'Baja' : 'Activar'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={
          <>
            <span aria-hidden="true">👤 </span>Datos del equipo
          </>
        }
        actions={
          <Link
            to="/more/settings/team"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
          >
            Ver todos
          </Link>
        }
      >
        <p className="more__muted">
          Cada empleado puede completar sus datos personales desde su perfil.
        </p>
      </Card>

      <Card
        title={
          <>
            <span aria-hidden="true">📅 </span>Calendario de tareas
          </>
        }
      >
        <TaskCalendar />
      </Card>

      <Card
        title={
          <>
            <span aria-hidden="true">🔐 </span>Seguridad
          </>
        }
      >
        <div className="more__stack">
          <Button variant="secondary" fullWidth onClick={() => setDialog({ kind: 'ownPin' })}>
            <span aria-hidden="true">🔑 </span>Cambiar PIN de administrador
          </Button>
          <Link
            to="/admin/users"
            className={buttonClassName({ variant: 'secondary', fullWidth: true })}
          >
            <span aria-hidden="true">👥 </span>Usuarios y accesos
          </Link>
        </div>
      </Card>

      <Card
        title={
          <>
            <span aria-hidden="true">📱 </span>Instalar como app
          </>
        }
      >
        <p className="more__muted">
          <b>iPhone:</b> Safari → Compartir → “Agregar a pantalla de inicio”
        </p>
        <p className="more__muted">
          <b>Android:</b> Chrome → menú ⋮ → “Agregar a pantalla de inicio”
        </p>
      </Card>

      {dialog.kind === 'form' ? (
        <EmployeeFormDialog
          employee={dialog.employee}
          onClose={close}
          onSaved={() => {
            close();
            setNotice(
              dialog.employee
                ? 'Persona actualizada.'
                : 'Persona agregada. Asignale su PIN con 🔑.',
            );
            afterEmployeeChange();
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {dialog.kind === 'status' ? (
        <ConfirmDialog
          title={`${dialog.employee.active ? 'Dar de baja' : 'Reactivar'} a ${dialog.employee.displayName}?`}
          description={
            dialog.employee.active
              ? 'Dejará de aparecer para asignar tareas y registros, y no podrá ingresar. Su historial se conserva.'
              : 'Vuelve a estar disponible y puede ingresar con su PIN.'
          }
          confirmLabel={dialog.employee.active ? 'Dar de baja' : 'Reactivar'}
          tone={dialog.employee.active ? 'danger' : 'default'}
          onCancel={close}
          onConfirm={async () => {
            try {
              await setEmployeeActive(dialog.employee.id, !dialog.employee.active);
            } catch (caught) {
              if (isSessionExpired(caught)) return handleSessionExpired();
              throw humanError(caught);
            }
            close();
            afterEmployeeChange();
          }}
        />
      ) : null}
      {dialog.kind === 'pin' && dialog.employee.account ? (
        <PinDialog
          mode={dialog.employee.account.status === 'PENDING_ACTIVATION' ? 'activate' : 'reset'}
          targetDisplayName={dialog.employee.displayName}
          isSelf={dialog.employee.account.userId === user?.id}
          onCancel={close}
          onSubmit={async (pin) => {
            const account = dialog.employee.account!;
            if (account.status === 'PENDING_ACTIVATION') await activateUser(account.userId, pin);
            else await resetUserPin(account.userId, pin);
            if (account.userId === user?.id) {
              close();
              await logout();
              return;
            }
            close();
            setNotice(`PIN de ${dialog.employee.displayName} guardado ✓`);
            afterAccountChange();
          }}
        />
      ) : null}
      {dialog.kind === 'ownPin' && user ? (
        <PinDialog
          mode="reset"
          targetDisplayName={user.employee?.displayName ?? 'Administrador'}
          isSelf
          onCancel={close}
          onSubmit={async (pin) => {
            await resetUserPin(user.id, pin);
            close();
            // Cambiar el propio PIN revoca la propia sesión (backend): cierre local, igual que en Usuarios.
            await logout();
          }}
        />
      ) : null}
    </div>
  );
}
