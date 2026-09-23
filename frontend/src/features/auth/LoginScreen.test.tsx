import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchLoginOptionsMock, loginMock } = vi.hoisted(() => ({
  fetchLoginOptionsMock: vi.fn(),
  loginMock: vi.fn(),
}));
vi.mock('../../api/authApi', () => ({ fetchLoginOptions: fetchLoginOptionsMock }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ login: loginMock }) }));

import { LoginScreen } from './LoginScreen';

const OPTION = {
  id: 'user-1',
  displayName: 'Coke',
  role: 'EMPLOYEE' as const,
  colorHex: '#4a7c59',
};

describe('LoginScreen', () => {
  beforeEach(() => {
    fetchLoginOptionsMock.mockReset();
    loginMock.mockReset();
    fetchLoginOptionsMock.mockResolvedValue({ options: [OPTION] });
  });

  it('muestra la identidad visual de La Cañada y el selector primero', async () => {
    render(<LoginScreen />);
    expect(screen.getByRole('heading', { name: /la cañada/i })).toBeInTheDocument();
    expect(await screen.findByText('Coke')).toBeInTheDocument();
  });

  it('seleccionar una identidad muestra la pantalla de PIN con su nombre', async () => {
    render(<LoginScreen />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /coke/i }));

    expect(screen.getByText('Ingresá tu PIN de 4 dígitos')).toBeInTheDocument();
    // El nombre aparece dos veces (subtítulo del selector cambia + pantalla de PIN) — alcanza con que exista.
    expect(screen.getAllByText('Coke').length).toBeGreaterThan(0);
  });

  it('volver desde la pantalla de PIN regresa al selector de identidad', async () => {
    render(<LoginScreen />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /coke/i }));
    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(screen.getByText('Elegí tu identidad para ingresar.')).toBeInTheDocument();
  });
});
