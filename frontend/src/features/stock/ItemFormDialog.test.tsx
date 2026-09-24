import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CATEGORY_A, CATEGORY_B, CATEGORY_BOTH, makeItem } from '../../test/fixtures/stock';
import { ItemFormDialog } from './ItemFormDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ItemFormDialog>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <ItemFormDialog
      categories={[CATEGORY_A, CATEGORY_B, CATEGORY_BOTH]}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
      onSessionExpired={vi.fn()}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('ItemFormDialog — contrato de escritura', () => {
  it('crea en saldo cero implícito y envía solo los campos permitidos', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.type(screen.getByLabelText('Nombre'), '  Producto   de prueba  ');
    await user.selectOptions(screen.getByLabelText('Área'), 'HOUSE');
    await user.selectOptions(screen.getByLabelText('Categoría'), CATEGORY_A.id);
    await user.type(screen.getByLabelText('Unidad'), '  unidad  ');
    fireEvent.change(screen.getByLabelText('Stock mínimo'), { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Producto de prueba',
      area: 'HOUSE',
      categoryId: CATEGORY_A.id,
      unit: 'unidad',
      minimumQuantity: '0',
    });
    expect(JSON.stringify(onSubmit.mock.calls[0]?.[0])).not.toMatch(
      /currentQuantity|active|OPENING_BALANCE/,
    );
  });

  it('en edición omite área, cantidad, estado y campos sin cambios', async () => {
    const user = userEvent.setup();
    const item = makeItem();
    const { onSubmit } = renderDialog({ item });

    expect(screen.queryByLabelText('Área')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Producto renombrado');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Producto renombrado' });
    expect(JSON.stringify(onSubmit.mock.calls[0]?.[0])).not.toMatch(/area|currentQuantity|active/);
  });

  it.each(['-1', '00', '01', '0.001', '123456789', '1e2', 'NaN', 'Infinity'])(
    'rechaza el stock mínimo ambiguo %s',
    async (value) => {
      const user = userEvent.setup();
      const { onSubmit } = renderDialog();
      await user.type(screen.getByLabelText('Nombre'), 'Producto válido');
      await user.selectOptions(screen.getByLabelText('Categoría'), CATEGORY_A.id);
      await user.type(screen.getByLabelText('Unidad'), 'kg');
      fireEvent.change(screen.getByLabelText('Stock mínimo'), { target: { value } });
      await user.click(screen.getByRole('button', { name: 'Crear producto' }));

      expect(screen.getByRole('alert')).toHaveTextContent(/número no negativo/i);
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it('no ofrece una categoría inactiva al crear pero conserva la actual al editar', () => {
    const { unmount } = render(
      <ItemFormDialog
        categories={[CATEGORY_A, CATEGORY_BOTH]}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
        onSessionExpired={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('option', { name: /categoría sintética ambas/i }),
    ).not.toBeInTheDocument();
    unmount();

    renderDialog({
      item: makeItem({
        category: {
          id: CATEGORY_BOTH.id,
          name: CATEGORY_BOTH.name,
          area: CATEGORY_BOTH.area,
        },
      }),
    });
    expect(
      screen.getByRole('option', { name: /categoría sintética ambas.*inactiva/i }),
    ).toBeInTheDocument();
  });
});
