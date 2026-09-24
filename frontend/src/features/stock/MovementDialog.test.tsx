import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeItem } from '../../test/fixtures/stock';
import { MovementDialog } from './MovementDialog';

const { fetchStockDestinationsMock } = vi.hoisted(() => ({
  fetchStockDestinationsMock: vi.fn(),
}));
vi.mock('../../api/stockApi', () => ({
  fetchStockDestinations: fetchStockDestinationsMock,
}));

const item = makeItem();

function renderDialog(overrides: Partial<React.ComponentProps<typeof MovementDialog>> = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <MovementDialog
      item={item}
      kind="income"
      role="EMPLOYEE"
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      onSessionExpired={vi.fn()}
      {...overrides}
    />,
  );
  return { onConfirm, ...result };
}

beforeEach(() => {
  fetchStockDestinationsMock.mockReset();
  fetchStockDestinationsMock.mockResolvedValue({ destinations: [] });
});

describe('MovementDialog — decimal estricto y contrato del body', () => {
  it.each(['0', '0.00', '00', '01', '00.50', '-1', '1.234', '123456789', '1e2', 'NaN', 'Infinity'])(
    'rechaza %s sin llamar al POST',
    async (value) => {
      const { onConfirm } = renderDialog();
      fireEvent.change(screen.getByLabelText('Cantidad'), { target: { value } });
      await userEvent.setup().click(screen.getByRole('button', { name: /registrar movimiento/i }));
      expect(screen.getByRole('alert')).toHaveTextContent(/cantidad/i);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('EMPLOYEE no puede inyectar fecha, destino, persona ni producto en un ingreso', async () => {
    const { onConfirm } = renderDialog();
    expect(screen.queryByLabelText(/fecha/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/destino/i)).not.toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText('Cantidad'), '2.50');
    await userEvent.setup().click(screen.getByRole('button', { name: /registrar movimiento/i }));
    expect(onConfirm).toHaveBeenCalledWith({ type: 'INCOME', quantity: '2.50' });
    expect(JSON.stringify(onConfirm.mock.calls[0]?.[0])).not.toMatch(
      /employeeId|stockItemId|currentQuantity|area|active|OPENING_BALANCE/,
    );
  });

  it('el rol, no el tipo de operación, decide si aparece la fecha', () => {
    const { unmount } = renderDialog({ role: 'ADMIN', kind: 'income' });
    expect(screen.getByLabelText(/fecha/i)).toBeInTheDocument();
    unmount();
    renderDialog({ role: 'EMPLOYEE', kind: 'adjustment' });
    expect(screen.queryByLabelText(/fecha/i)).not.toBeInTheDocument();
  });
});
