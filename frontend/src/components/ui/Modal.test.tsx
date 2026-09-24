import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function Harness({ closeDisabled = false }: { closeDisabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir diálogo
      </button>
      {open ? (
        <Modal
          titleId="t"
          descriptionId="d"
          onRequestClose={() => setOpen(false)}
          closeDisabled={closeDisabled}
        >
          <h2 id="t">Título del diálogo</h2>
          <p id="d">Descripción del efecto.</p>
          <button type="button">Primero</button>
          <button type="button" onClick={() => setOpen(false)}>
            Último
          </button>
        </Modal>
      ) : null}
    </>
  );
}

describe('Modal', () => {
  it('es un diálogo modal con nombre y descripción accesibles', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir diálogo' }));

    const dialog = screen.getByRole('dialog', { name: 'Título del diálogo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Descripción del efecto.');
  });

  it('foco inicial en el primer control y foco contenido con Tab / Shift+Tab', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir diálogo' }));

    const first = screen.getByRole('button', { name: 'Primero' });
    const last = screen.getByRole('button', { name: 'Último' });
    expect(first).toHaveFocus();

    await user.tab();
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('Escape cierra y devuelve el foco al control que lo abrió', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Abrir diálogo' });
    await user.click(trigger);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('mientras se envía (closeDisabled), Escape no cierra', async () => {
    render(<Harness closeDisabled />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir diálogo' }));

    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('bloquea el scroll del fondo mientras está abierto y lo libera al cerrar', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir diálogo' }));
    expect(document.documentElement).toHaveClass('has-modal');

    await user.keyboard('{Escape}');
    expect(document.documentElement).not.toHaveClass('has-modal');
  });

  it('no se cierra con un click en el overlay (evita descartar un PIN a medio escribir)', async () => {
    const onRequestClose = vi.fn();
    render(
      <Modal titleId="t" onRequestClose={onRequestClose}>
        <h2 id="t">Título</h2>
        <button type="button">Acción</button>
      </Modal>,
    );
    const user = userEvent.setup();
    const overlay = screen.getByRole('dialog').parentElement as HTMLElement;

    await user.click(overlay);

    expect(onRequestClose).not.toHaveBeenCalled();
  });
});
