import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminUserListItem } from '../../api/adminTypes';
import { AdminUserRow } from './AdminUserRow';

function makeUser(overrides: Partial<AdminUserListItem>): AdminUserListItem {
  return {
    id: 'user-1',
    username: 'coke',
    role: 'EMPLOYEE',
    status: 'PENDING_ACTIVATION',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    employee: { id: 'employee-1', displayName: 'Coke' },
    ...overrides,
  };
}

const noop = { onActivate: vi.fn(), onResetPin: vi.fn(), onChangeStatus: vi.fn() };

describe('AdminUserRow', () => {
  it('usuario PENDING_ACTIVATION muestra "Activar y asignar PIN", nunca "Cambiar PIN"', () => {
    render(
      <ul>
        <AdminUserRow user={makeUser({})} isSelf={false} wouldSelfLockout={false} {...noop} />
      </ul>,
    );
    expect(screen.getByRole('button', { name: /activar y asignar pin/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cambiar pin/i })).not.toBeInTheDocument();
  });

  it('usuario ACTIVE muestra "Cambiar PIN", nunca la acción de activación', () => {
    render(
      <ul>
        <AdminUserRow
          user={makeUser({ status: 'ACTIVE' })}
          isSelf={false}
          wouldSelfLockout={false}
          {...noop}
        />
      </ul>,
    );
    expect(screen.getByRole('button', { name: /cambiar pin/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /activar y asignar pin/i }),
    ).not.toBeInTheDocument();
  });

  it('nunca muestra pinHash ni ningún dato sensible', () => {
    render(
      <ul>
        <AdminUserRow
          user={makeUser({ status: 'ACTIVE' })}
          isSelf={false}
          wouldSelfLockout={false}
          {...noop}
        />
      </ul>,
    );
    expect(screen.queryByText(/\$argon2/i)).not.toBeInTheDocument();
  });

  it('distingue visualmente rol y estado con etiquetas en español', () => {
    render(
      <ul>
        <AdminUserRow
          user={makeUser({ status: 'SUSPENDED', role: 'ADMIN' })}
          isSelf={false}
          wouldSelfLockout={false}
          {...noop}
        />
      </ul>,
    );
    expect(screen.getByText('Administrador')).toBeInTheDocument();
    expect(screen.getByText('Suspendido')).toBeInTheDocument();
  });

  it('click en "Activar y asignar PIN" invoca onActivate con el usuario', async () => {
    const onActivate = vi.fn();
    render(
      <ul>
        <AdminUserRow
          user={makeUser({})}
          isSelf={false}
          wouldSelfLockout={false}
          {...noop}
          onActivate={onActivate}
        />
      </ul>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /activar y asignar pin/i }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
  });

  it('ofrece únicamente transiciones de estado permitidas por el backend', () => {
    render(
      <ul>
        <AdminUserRow
          user={makeUser({ status: 'ACTIVE' })}
          isSelf={false}
          wouldSelfLockout={false}
          {...noop}
        />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deshabilitar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivar' })).not.toBeInTheDocument();
  });

  it('nunca ofrece auto-bloqueo: deshabilita la transición que dejaría al sistema sin administradores', () => {
    render(
      <ul>
        <AdminUserRow
          user={makeUser({ status: 'ACTIVE', role: 'ADMIN' })}
          isSelf
          wouldSelfLockout
          {...noop}
        />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'Suspender' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deshabilitar' })).toBeDisabled();
  });
});
