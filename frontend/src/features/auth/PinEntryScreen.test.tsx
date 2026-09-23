import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }));
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ login: loginMock }) }));

import { ApiError } from '../../api/httpClient';
import { PinEntryScreen } from './PinEntryScreen';

const OPTION = {
  id: 'user-1',
  displayName: 'Coke',
  role: 'EMPLOYEE' as const,
  colorHex: '#4a7c59',
};

describe('PinEntryScreen', () => {
  beforeEach(() => {
    loginMock.mockReset();
  });

  it('muestra el nombre de la identidad elegida', () => {
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    expect(screen.getByText('Coke')).toBeInTheDocument();
  });

  it('ingreso mediante el teclado numérico en pantalla completa el PIN y llama a login con el string exacto', async () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    for (const digit of ['0', '0', '0', '7']) {
      await user.click(screen.getByRole('button', { name: `Dígito ${digit}` }));
    }

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user-1', '0007'));
  });

  it('ingreso mediante teclado físico (dígitos) también completa y envía el PIN', async () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('4821');

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user-1', '4821'));
  });

  it('Backspace físico borra el último dígito antes de completar el PIN', async () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('482{Backspace}21');

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('user-1', '4821'));
  });

  it('nunca envía un PIN incompleto (ni con Enter)', async () => {
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('482{Enter}');

    expect(loginMock).not.toHaveBeenCalled();
  });

  it('Escape vuelve al selector', async () => {
    const onBack = vi.fn();
    render(<PinEntryScreen option={OPTION} onBack={onBack} />);
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('el botón "Volver" limpia el PIN y vuelve al selector', async () => {
    const onBack = vi.fn();
    render(<PinEntryScreen option={OPTION} onBack={onBack} />);
    const user = userEvent.setup();

    await user.keyboard('48');
    await user.click(screen.getByRole('button', { name: /volver/i }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('login rechazado (credenciales inválidas): limpia el PIN y muestra el mensaje genérico del backend', async () => {
    loginMock.mockRejectedValue(
      new ApiError(401, 'Identidad o PIN incorrectos.', 'AUTH_INVALID_CREDENTIALS'),
    );
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('0000');

    expect(await screen.findByRole('alert')).toHaveTextContent('Identidad o PIN incorrectos.');
  });

  it('error de red: muestra un mensaje distinto, nunca "PIN incorrecto"', async () => {
    loginMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('0000');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/incorrect/i);
    expect(alert).toHaveTextContent(/no se pudo conectar/i);
  });

  it('previene doble envío: dos intentos casi simultáneos de completar el PIN solo llaman a login una vez', async () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    // Cuatro clicks rapidísimos - el pad se deshabilita apenas se completa,
    // pero la guarda real es el ref síncrono, no solo el `disabled` del DOM.
    await user.keyboard('4821');
    await user.keyboard('4821'); // pin ya está lleno; el pad debería estar disabled

    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('el pad numérico se deshabilita mientras se verifica el login', async () => {
    loginMock.mockReturnValue(new Promise(() => {}));
    render(<PinEntryScreen option={OPTION} onBack={vi.fn()} />);
    const user = userEvent.setup();

    await user.keyboard('4821');

    await waitFor(() => {
      for (const button of screen.getAllByRole('button', { name: /dígito/i })) {
        expect(button).toBeDisabled();
      }
    });
    expect(screen.getByText(/verificando/i)).toBeInTheDocument();
  });
});
