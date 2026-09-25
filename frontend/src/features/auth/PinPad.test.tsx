import { render, screen } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PinPad } from './PinPad';

describe('PinPad', () => {
  it('cada dígito tiene nombre accesible propio y llama a onDigit con su valor', async () => {
    const onDigit = vi.fn();
    render(<PinPad onDigit={onDigit} onBackspace={vi.fn()} onClear={vi.fn()} disabled={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dígito 7' }));

    expect(onDigit).toHaveBeenCalledWith('7');
  });

  it('preserva el 0 como dígito propio (no se pierde ni se confunde con "vacío")', async () => {
    const onDigit = vi.fn();
    render(<PinPad onDigit={onDigit} onBackspace={vi.fn()} onClear={vi.fn()} disabled={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Dígito 0' }));

    expect(onDigit).toHaveBeenCalledWith('0');
  });

  it('botón de borrar último dígito', async () => {
    const onBackspace = vi.fn();
    render(
      <PinPad onDigit={vi.fn()} onBackspace={onBackspace} onClear={vi.fn()} disabled={false} />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Borrar último dígito' }));

    expect(onBackspace).toHaveBeenCalledTimes(1);
  });

  it('botón de limpiar todo el PIN', async () => {
    const onClear = vi.fn();
    render(<PinPad onDigit={vi.fn()} onBackspace={vi.fn()} onClear={onClear} disabled={false} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Limpiar PIN' }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado: ningún botón responde', async () => {
    const onDigit = vi.fn();
    render(<PinPad onDigit={onDigit} onBackspace={vi.fn()} onClear={vi.fn()} disabled />);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('cuadrícula completa: los 10 dígitos más borrar y limpiar, cada uno con nombre propio', () => {
    render(<PinPad onDigit={vi.fn()} onBackspace={vi.fn()} onClear={vi.fn()} disabled={false} />);

    const group = screen.getByRole('group', { name: 'Teclado numérico' });
    expect(group.querySelectorAll('button')).toHaveLength(12);
    for (const digit of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      expect(screen.getByRole('button', { name: `Dígito ${digit}` })).toBeInTheDocument();
    }
  });
});
