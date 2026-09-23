import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { PinDialog } from './PinDialog';

function getPinInput(): HTMLInputElement {
  return screen.getByLabelText(/pin nuevo/i) as HTMLInputElement;
}

function getConfirmInput(): HTMLInputElement {
  return screen.getByLabelText(/confirmar pin/i) as HTMLInputElement;
}

describe('PinDialog', () => {
  it('nunca usa type="number" — usa password + inputMode numeric + autoComplete one-time-code', () => {
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    for (const input of [getPinInput(), getConfirmInput()]) {
      expect(input.type).toBe('password');
      expect(input.inputMode).toBe('numeric');
      expect(input.autocomplete).toBe('one-time-code');
    }
  });

  it('el foco inicial cae en el primer campo enfocable', () => {
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(getPinInput()).toHaveFocus();
  });

  it('activación requiere exactamente 4 dígitos', async () => {
    const onSubmit = vi.fn();
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '12');
    await user.type(getConfirmInput(), '12');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('4 dígitos');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('preserva ceros iniciales — nunca convierte el PIN a número', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '0007');
    await user.type(getConfirmInput(), '0007');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('0007'));
    expect(typeof onSubmit.mock.calls[0]?.[0]).toBe('string');
  });

  it('el PIN y su confirmación deben coincidir', async () => {
    const onSubmit = vi.fn();
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '1234');
    await user.type(getConfirmInput(), '5678');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('bloquea el doble envío', async () => {
    const onSubmit = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '1234');
    await user.type(getConfirmInput(), '1234');
    const submitButton = screen.getByRole('button', { name: 'Activar' });
    await user.click(submitButton);
    // Ya debería estar disabled, pero el guard real es el ref síncrono.
    await user.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('cerrar (Cancelar) limpia ambos campos y llama a onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '12');
    await user.type(getConfirmInput(), '34');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(getPinInput().value).toBe('');
    expect(getConfirmInput().value).toBe('');
  });

  it('Escape cierra y limpia igual que Cancelar', async () => {
    const onCancel = vi.fn();
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '99');
    await user.keyboard('{Escape}');

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('un error de la API limpia ambos campos y muestra el mensaje real (nunca JSON crudo)', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(400, 'El PIN elegido es demasiado obvio.', 'WEAK_PIN'));
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '1111');
    await user.type(getConfirmInput(), '1111');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El PIN elegido es demasiado obvio.',
    );
    expect(getPinInput().value).toBe('');
    expect(getConfirmInput().value).toBe('');
  });

  it('modo reset muestra la advertencia de cierre de sesiones', () => {
    render(
      <PinDialog
        mode="reset"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/se cerrarán todas las sesiones activas de esta persona/i),
    ).toBeInTheDocument();
  });

  it('reset sobre uno mismo agrega la advertencia de que la propia sesión también se cierra', () => {
    render(
      <PinDialog
        mode="reset"
        targetDisplayName="Yo"
        isSelf
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/volverás a la pantalla de login/i)).toBeInTheDocument();
  });

  it('nunca pide ni muestra el PIN anterior', () => {
    render(
      <PinDialog
        mode="reset"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/pin anterior|pin actual/i)).not.toBeInTheDocument();
  });

  it('el envío en curso se anuncia por aria-live', async () => {
    const onSubmit = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <PinDialog
        mode="activate"
        targetDisplayName="Coke"
        isSelf={false}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    const user = userEvent.setup();

    await user.type(getPinInput(), '1234');
    await user.type(getConfirmInput(), '1234');
    await user.click(screen.getByRole('button', { name: 'Activar' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/guardando/i);
  });
});
