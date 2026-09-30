import { fireEvent, render, screen } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  CATEGORY_A,
  CATEGORY_B,
  CATEGORY_BOTH,
  makeItem,
  makeLegacyItem,
} from '../../test/fixtures/stock';
import { ItemFormDialog } from './ItemFormDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ItemFormDialog>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <ItemFormDialog
      categories={[CATEGORY_A, CATEGORY_B, CATEGORY_BOTH]}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
      onSessionExpired={vi.fn()}
      {...overrides}
    />,
  );
  return { onSubmit, unmount: result.unmount };
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
    // El stock objetivo es obligatorio en productos nuevos.
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));
    expect(await screen.findByText('El stock objetivo es obligatorio.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Cantidad a la que querés llegar al reponer/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stock objetivo'), { target: { value: '12.5' } });
    await user.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Producto de prueba',
      area: 'HOUSE',
      categoryId: CATEGORY_A.id,
      unit: 'unidad',
      minimumQuantity: '0',
      targetQuantity: '12.5',
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

  it.each([
    ['igual', '10'],
    ['menor', '9.99'],
  ])('rechaza un objetivo %s al mínimo sin enviar', async (_label, value) => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ item: makeItem() });
    fireEvent.change(screen.getByLabelText('Stock objetivo'), { target: { value } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText('El stock objetivo debe ser mayor que el stock mínimo.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('edita el objetivo enviando solo ese campo', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog({ item: makeItem() });
    expect(screen.getByLabelText('Stock objetivo')).toHaveValue('30');
    fireEvent.change(screen.getByLabelText('Stock objetivo'), { target: { value: '50' } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSubmit).toHaveBeenCalledWith({ targetQuantity: '50' });
  });

  it('producto anterior sin objetivo: se renombra sin completarlo, pero cambiar el mínimo lo exige', async () => {
    const user = userEvent.setup();
    const legacy = makeLegacyItem();
    const first = renderDialog({ item: legacy });
    expect(screen.getByLabelText('Stock objetivo')).toHaveValue('');
    expect(screen.getByLabelText('Stock objetivo')).toHaveAttribute('placeholder', 'Pendiente');
    await user.clear(screen.getByLabelText('Nombre'));
    await user.type(screen.getByLabelText('Nombre'), 'Renombrado');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(first.onSubmit).toHaveBeenCalledWith({ name: 'Renombrado' });
    first.unmount();

    const second = renderDialog({ item: legacy });
    fireEvent.change(screen.getByLabelText('Stock mínimo'), { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(
      await screen.findByText('Completá el stock objetivo para cambiar el stock mínimo.'),
    ).toBeInTheDocument();
    expect(second.onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Stock objetivo'), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(second.onSubmit).toHaveBeenCalledWith({ minimumQuantity: '4', targetQuantity: '20' });
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
