import { render, screen, waitFor } from '../../test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { PERSON_A, PERSON_B, makeTask } from '../../test/fixtures/tasks';
import { TaskFormDialog } from './TaskFormDialog';

function renderForm(props: Partial<Parameters<typeof TaskFormDialog>[0]> = {}) {
  const handlers = {
    onCancel: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
  };
  render(<TaskFormDialog employees={[PERSON_A, PERSON_B]} {...handlers} {...props} />);
  return handlers;
}

describe('TaskFormDialog', () => {
  it('es un diálogo accesible con labels reales y foco inicial en la descripción', () => {
    renderForm();
    expect(screen.getByRole('dialog', { name: 'Nueva tarea' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(screen.getByLabelText('Descripción')).toHaveFocus();
    expect(screen.getByLabelText('Responsable')).toBeInTheDocument();
    expect(screen.getByLabelText('Frecuencia')).toBeInTheDocument();
  });

  it('carga como opciones los empleados reales recibidos (sin lista fija)', () => {
    renderForm();
    const options = Array.from(
      (screen.getByLabelText('Responsable') as HTMLSelectElement).options,
    ).map((option) => option.textContent);
    expect(options).toEqual(['Elegí una persona', PERSON_A.displayName, PERSON_B.displayName]);
  });

  it('valida la descripción antes de enviar (mínimo y HTML)', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Descripción'), 'ab');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/al menos 3/);

    await user.clear(screen.getByLabelText('Descripción'));
    await user.type(screen.getByLabelText('Descripción'), '<b>Regar</b>');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/HTML/);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('crear envía el contrato exacto, con la descripción normalizada', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Descripción'), '  Tarea   sintética nueva ');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_B.id);
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'WEEKLY');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética nueva',
        employeeId: PERSON_B.id,
        frequency: 'WEEKLY',
      }),
    );
  });

  it('editar envía solo los campos que cambiaron', async () => {
    const task = makeTask();
    const { onUpdate } = renderForm({ task });
    const user = userEvent.setup();
    expect(screen.getByRole('dialog', { name: 'Editar tarea' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'MONTHLY');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(task.id, { frequency: 'MONTHLY' }));
  });

  it('ofrece «Quincenal» entre Semanal y Mensual, con su ayuda al elegirla', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    const select = screen.getByLabelText('Frecuencia') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Elegí una frecuencia',
      'Urgente',
      'Una vez',
      'Diaria',
      'Semanal',
      'Quincenal',
      'Mensual',
    ]);
    expect(screen.queryByText(/del 1 al 15/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Descripción'), 'Tarea sintética quincenal');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_A.id);
    await user.selectOptions(select, 'SEMI_MONTHLY');
    expect(select).toHaveAccessibleDescription(
      'Una vez del 1 al 15 y otra del 16 al último día del mes',
    );
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética quincenal',
        employeeId: PERSON_A.id,
        frequency: 'SEMI_MONTHLY',
      }),
    );

    await user.selectOptions(select, 'MONTHLY');
    expect(screen.queryByText(/del 1 al 15/)).not.toBeInTheDocument();
    expect(select).not.toHaveAttribute('aria-describedby');
  });

  it('editar una quincenal la muestra elegida y permite pasarla a otra frecuencia', async () => {
    const task = makeTask({ frequency: 'SEMI_MONTHLY', periodKey: '2026-09-Q2' });
    const { onUpdate } = renderForm({ task });
    const user = userEvent.setup();
    expect(screen.getByLabelText('Frecuencia')).toHaveValue('SEMI_MONTHLY');
    expect(screen.getByText(/del 16 al último día del mes/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'WEEKLY');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(task.id, { frequency: 'WEEKLY' }));
  });

  it('bloquea el doble envío', async () => {
    const onCreate = vi.fn().mockReturnValue(new Promise(() => {}));
    renderForm({ onCreate });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Descripción'), 'Tarea sintética');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_A.id);
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'DAILY');
    const submit = screen.getByRole('button', { name: 'Crear tarea' });
    await user.click(submit);
    await user.click(submit);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('muestra el error del backend sin JSON crudo y mantiene el diálogo abierto', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          409,
          'Ese responsable ya tiene una tarea con la misma descripción.',
          'TASK_DUPLICATE',
        ),
      );
    renderForm({ onCreate });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Descripción'), 'Tarea sintética');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_A.id);
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'DAILY');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('misma descripción');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape cierra (cuando no se está enviando)', async () => {
    const { onCancel } = renderForm();
    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
