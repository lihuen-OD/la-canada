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
      'Bimestral',
      'Anual',
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

describe('TaskFormDialog — Bimestral, Anual y fecha para «Una vez»', () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>, frequency: string) {
    await user.type(screen.getByLabelText('Descripción'), 'Tarea sintética');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_A.id);
    await user.selectOptions(screen.getByLabelText('Frecuencia'), frequency);
  }

  it.each([
    ['BIMONTHLY', 'Una vez por bimestre calendario: ene–feb, mar–abr…'],
    ['ANNUAL', 'Una vez por año calendario'],
  ])('%s muestra su ayuda y no pide fecha', async (frequency, hint) => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fillBasics(user, frequency);
    expect(screen.getByLabelText('Frecuencia')).toHaveAccessibleDescription(hint);
    expect(screen.queryByLabelText('Fecha para realizar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética',
        employeeId: PERSON_A.id,
        frequency,
      }),
    );
  });

  it('la fecha solo aparece en «Una vez», muestra el día de la semana y viaja como fecha ISO', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    expect(screen.queryByLabelText('Fecha para realizar')).not.toBeInTheDocument();
    await fillBasics(user, 'ONE_TIME');
    const date = screen.getByLabelText('Fecha para realizar');
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveAccessibleDescription(/Opcional/);
    await user.type(date, '2026-10-26');
    expect(date).toHaveAccessibleDescription('Lunes 26/10/2026');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética',
        employeeId: PERSON_A.id,
        frequency: 'ONE_TIME',
        scheduledDate: '2026-10-26',
      }),
    );
  });

  it('«Una vez» sin fecha: no envía el campo (comportamiento de siempre)', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fillBasics(user, 'ONE_TIME');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética',
        employeeId: PERSON_A.id,
        frequency: 'ONE_TIME',
      }),
    );
  });

  it('elegir otra frecuencia oculta la fecha y no la envía', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fillBasics(user, 'ONE_TIME');
    await user.type(screen.getByLabelText('Fecha para realizar'), '2026-10-26');
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'DAILY');
    expect(screen.queryByLabelText('Fecha para realizar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        description: 'Tarea sintética',
        employeeId: PERSON_A.id,
        frequency: 'DAILY',
      }),
    );
  });

  const dated = makeTask({
    frequency: 'ONE_TIME',
    periodKey: 'ONE_TIME',
    scheduledDate: '2026-10-26',
    scheduleStatus: 'SCHEDULED',
  });

  it('editar: reprogramar envía solo la fecha nueva', async () => {
    const { onUpdate } = renderForm({ task: dated });
    const user = userEvent.setup();
    const date = screen.getByLabelText('Fecha para realizar');
    expect(date).toHaveValue('2026-10-26');
    expect(date).toHaveAccessibleDescription('Lunes 26/10/2026');
    await user.clear(date);
    await user.type(date, '2026-10-30');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(dated.id, { scheduledDate: '2026-10-30' }),
    );
  });

  it('editar: quitar la fecha envía null', async () => {
    const { onUpdate } = renderForm({ task: dated });
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Fecha para realizar'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(dated.id, { scheduledDate: null }));
  });

  it('editar otra cosa: la fecha sin tocar no se envía', async () => {
    const { onUpdate } = renderForm({ task: dated });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Descripción'), ' revisada');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(dated.id, {
        description: `${dated.description} revisada`,
      }),
    );
  });

  it('editar: pasar de «Una vez» a otra frecuencia no envía la fecha (el backend la quita)', async () => {
    const { onUpdate } = renderForm({ task: dated });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'ANNUAL');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(dated.id, { frequency: 'ANNUAL' }));
  });

  it('muestra el rechazo del backend para una fecha inválida y conserva lo cargado', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValue(
        new ApiError(400, 'La fecha para realizar no existe.', 'VALIDATION_ERROR'),
      );
    renderForm({ onCreate });
    const user = userEvent.setup();
    await fillBasics(user, 'ONE_TIME');
    await user.type(screen.getByLabelText('Fecha para realizar'), '2026-10-26');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha para realizar no existe.');
    expect(screen.getByLabelText('Fecha para realizar')).toHaveValue('2026-10-26');
  });
});

describe('TaskFormDialog — orden de realización y programación sugerida', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, frequency: string) {
    await user.type(screen.getByLabelText('Descripción'), 'Tarea sintética');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_A.id);
    await user.selectOptions(screen.getByLabelText('Frecuencia'), frequency);
  }
  const base = { description: 'Tarea sintética', employeeId: PERSON_A.id };

  it('orden: opcional para todas las frecuencias, con su ayuda; vacío no se envía', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fill(user, 'DAILY');
    const order = screen.getByLabelText('Orden de realización');
    expect(order).toHaveAccessibleDescription('Los números menores aparecen primero. Es opcional');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ ...base, frequency: 'DAILY' }));
  });

  it.each(['0', '-1', '1.5', '10000'])('orden «%s» se rechaza antes de enviar', async (value) => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fill(user, 'URGENT');
    await user.type(screen.getByLabelText('Orden de realización'), value);
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'El orden de realización debe ser un número entero de 1 a 9999.',
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['DAILY', []],
    ['URGENT', []],
    ['ONE_TIME', []],
    ['WEEKLY', ['Día sugerido']],
    ['SEMI_MONTHLY', ['Día sugerido, primera quincena', 'Día sugerido, segunda quincena']],
    ['MONTHLY', ['Día sugerido del mes']],
    ['BIMONTHLY', ['Mes del bimestre', 'Día sugerido']],
    ['ANNUAL', ['Mes sugerido', 'Día sugerido']],
  ] as const)('%s muestra solo sus campos de sugerencia', async (frequency, labels) => {
    renderForm();
    await userEvent.setup().selectOptions(screen.getByLabelText('Frecuencia'), frequency);
    const shown = [
      'Día sugerido',
      'Día sugerido, primera quincena',
      'Día sugerido, segunda quincena',
      'Día sugerido del mes',
      'Mes del bimestre',
      'Mes sugerido',
    ].filter((label) => screen.queryByLabelText(label) !== null);
    expect(shown.sort()).toEqual([...labels].sort());
  });

  it('crear: semanal con día y orden; la ayuda aclara que es una sugerencia', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fill(user, 'WEEKLY');
    const weekday = screen.getByLabelText('Día sugerido');
    expect(weekday).toHaveAccessibleDescription(/Es una sugerencia: no cambia el período/);
    await user.selectOptions(weekday, 'Miércoles');
    await user.type(screen.getByLabelText('Orden de realización'), '2');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        ...base,
        frequency: 'WEEKLY',
        executionOrder: 2,
        suggestedWeekday: 3,
      }),
    );
  });

  it('quincenal: cada quincena por separado; la ayuda explica el último día del mes', async () => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fill(user, 'SEMI_MONTHLY');
    const second = screen.getByLabelText('Día sugerido, segunda quincena');
    expect(second).toHaveAccessibleDescription(/31 de abril → 30 de abril/);
    await user.selectOptions(second, '31');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        ...base,
        frequency: 'SEMI_MONTHLY',
        suggestedSecondHalfDay: 31,
      }),
    );
  });

  it.each(['BIMONTHLY', 'ANNUAL'])('%s exige mes y día juntos', async (frequency) => {
    const { onCreate } = renderForm();
    const user = userEvent.setup();
    await fill(user, frequency);
    await user.selectOptions(screen.getByLabelText('Día sugerido'), '29');
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Para una sugerencia bimestral o anual elegí el mes y el día, o dejá ambos vacíos.',
    );
    expect(onCreate).not.toHaveBeenCalled();
    await user.selectOptions(
      screen.getByLabelText(frequency === 'ANNUAL' ? 'Mes sugerido' : 'Mes del bimestre'),
      frequency === 'ANNUAL' ? 'Febrero' : 'Segundo mes',
    );
    await user.click(screen.getByRole('button', { name: 'Crear tarea' }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        ...base,
        frequency,
        suggestedMonth: 2,
        suggestedMonthDay: 29,
      }),
    );
  });

  const monthly = makeTask({
    frequency: 'MONTHLY',
    periodKey: '2026-10-01',
    executionOrder: 3,
    suggestedMonthDay: 31,
    suggestedDate: '2026-10-31',
  });

  it('editar otra cosa no envía orden ni sugerencia (se conservan)', async () => {
    const { onUpdate } = renderForm({ task: monthly });
    const user = userEvent.setup();
    expect(screen.getByLabelText('Orden de realización')).toHaveValue(3);
    expect(screen.getByLabelText('Día sugerido del mes')).toHaveValue('31');
    await user.selectOptions(screen.getByLabelText('Responsable'), PERSON_B.id);
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(monthly.id, { employeeId: PERSON_B.id }),
    );
  });

  it('editar: quitar orden y sugerencia envía null', async () => {
    const { onUpdate } = renderForm({ task: monthly });
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Orden de realización'));
    await user.selectOptions(screen.getByLabelText('Día sugerido del mes'), 'Sin sugerencia');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(monthly.id, {
        executionOrder: null,
        suggestedMonthDay: null,
      }),
    );
  });

  it('cambiar de frecuencia: avisa, conserva lo que sigue valiendo y el orden', async () => {
    const weekly = makeTask({
      frequency: 'WEEKLY',
      periodKey: '2026-10-26',
      executionOrder: 1,
      suggestedWeekday: 3,
    });
    const { onUpdate } = renderForm({ task: weekly });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'MONTHLY');
    expect(screen.getByRole('status')).toHaveTextContent(
      'La programación sugerida que no corresponde a la nueva frecuencia se quita al guardar.',
    );
    expect(screen.getByLabelText('Orden de realización')).toHaveValue(1);
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(weekly.id, { frequency: 'MONTHLY' }));
  });

  it('mensual día 31 → anual: el día sigue y solo falta elegir el mes', async () => {
    const { onUpdate } = renderForm({ task: monthly });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Frecuencia'), 'ANNUAL');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Día sugerido')).toHaveValue('31');
    await user.selectOptions(screen.getByLabelText('Mes sugerido'), 'Abril');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(monthly.id, {
        frequency: 'ANNUAL',
        suggestedMonth: 4,
      }),
    );
  });
});
