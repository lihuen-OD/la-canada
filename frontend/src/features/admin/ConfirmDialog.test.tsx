import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('no aplica nada hasta que se confirma explícitamente', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Suspender a Coke"
        description="Descripción"
        confirmLabel="Suspender"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmar llama a onConfirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmDialog
        title="Suspender a Coke"
        description="Descripción"
        confirmLabel="Suspender"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Suspender' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cancelar llama a onCancel sin llamar a onConfirm', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        title="Suspender a Coke"
        description="Descripción"
        confirmLabel="Suspender"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('un error de la API se muestra sin JSON crudo ni stack trace', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'No podés dejar el sistema sin administradores.', 'AUTH_SELF_LOCKOUT'),
      );
    render(
      <ConfirmDialog
        title="Suspenderme"
        description="Descripción"
        confirmLabel="Suspender"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Suspender' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No podés dejar el sistema sin administradores.',
    );
  });

  it('bloquea el doble envío', async () => {
    const onConfirm = vi.fn().mockReturnValue(new Promise(() => {}));
    render(
      <ConfirmDialog
        title="Suspender a Coke"
        description="Descripción"
        confirmLabel="Suspender"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Suspender' });

    await user.click(button);
    await user.click(button);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
