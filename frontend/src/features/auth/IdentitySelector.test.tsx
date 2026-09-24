import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchLoginOptionsMock } = vi.hoisted(() => ({ fetchLoginOptionsMock: vi.fn() }));
vi.mock('../../api/authApi', () => ({ fetchLoginOptions: fetchLoginOptionsMock }));

import { NEUTRAL_AVATAR_COLOR } from '../../utils/color';
import { IdentitySelector } from './IdentitySelector';

function avatarColorOf(card: HTMLElement): string | undefined {
  return card.querySelector<HTMLElement>('[data-avatar]')?.style.getPropertyValue('--avatar-color');
}

const EMPLOYEE_OPTION = {
  id: 'user-1',
  displayName: 'Coke',
  role: 'EMPLOYEE' as const,
  colorHex: '#4a7c59',
};
const ADMIN_OPTION = {
  id: 'admin-1',
  displayName: 'Administrador',
  role: 'ADMIN' as const,
  colorHex: null,
};

describe('IdentitySelector', () => {
  beforeEach(() => {
    fetchLoginOptionsMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('muestra un estado de carga mientras llega la respuesta', () => {
    fetchLoginOptionsMock.mockReturnValue(new Promise(() => {}));
    render(<IdentitySelector onSelect={vi.fn()} />);
    expect(screen.getByText(/cargando identidades/i)).toBeInTheDocument();
  });

  it('consume la forma real de la respuesta ({ options: [...] }) y muestra una tarjeta por identidad', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [EMPLOYEE_OPTION, ADMIN_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    expect(await screen.findByText('Coke')).toBeInTheDocument();
    expect(screen.getAllByText('Administrador').length).toBeGreaterThan(0);
  });

  it('distingue al administrador visual y semánticamente', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [EMPLOYEE_OPTION, ADMIN_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    await screen.findByText('Coke');
    // Nombre accesible explícito, no solo una etiqueta visual o un color.
    expect(screen.getByRole('button', { name: /cuenta de administrador/i })).toBeInTheDocument();
    // El empleado no debe tener la misma marca.
    const employeeCard = screen.getByRole('button', { name: /coke/i });
    expect(employeeCard).not.toHaveAccessibleName(/administrador/i);
    expect(employeeCard.textContent).not.toMatch(/administrador/i);
  });

  it('estado vacío real: sin identidades habilitadas, con el copy exacto pedido', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    expect(
      await screen.findByText('Todavía no hay usuarios habilitados para ingresar.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'El administrador debe crear su acceso inicial y habilitar a los integrantes del equipo.',
      ),
    ).toBeInTheDocument();
    // Nunca reemplazado por fixtures — cero botones de identidad.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('error de carga: muestra un mensaje y permite reintentar', async () => {
    fetchLoginOptionsMock.mockRejectedValueOnce(new Error('network down'));
    render(<IdentitySelector onSelect={vi.fn()} />);

    await screen.findByRole('alert');
    fetchLoginOptionsMock.mockResolvedValueOnce({ options: [EMPLOYEE_OPTION] });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /reintentar/i }));

    await waitFor(() => expect(screen.getByText('Coke')).toBeInTheDocument());
    expect(fetchLoginOptionsMock).toHaveBeenCalledTimes(2);
  });

  it('selecciona la identidad correcta al hacer click en su tarjeta', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [EMPLOYEE_OPTION] });
    const onSelect = vi.fn();
    render(<IdentitySelector onSelect={onSelect} />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /coke/i }));

    expect(onSelect).toHaveBeenCalledWith(EMPLOYEE_OPTION);
  });

  it('usa colorHex de forma segura: un valor null cae a un color neutro sin romper el render', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [{ ...EMPLOYEE_OPTION, colorHex: null }] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: /coke/i });
    expect(avatarColorOf(card)).toBe(NEUTRAL_AVATAR_COLOR);
  });

  it('usa el color validado del perfil cuando es un hex válido', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [EMPLOYEE_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: /coke/i });
    expect(avatarColorOf(card)).toBe('#4a7c59');
  });

  it('usa colorHex de forma segura: un valor no-hex (potencialmente hostil) también cae al color neutro', async () => {
    const malformed = { ...EMPLOYEE_OPTION, colorHex: 'javascript:alert(1)' };
    fetchLoginOptionsMock.mockResolvedValue({ options: [malformed] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: /coke/i });
    expect(avatarColorOf(card)).toBe(NEUTRAL_AVATAR_COLOR);
    expect(card.outerHTML).not.toContain('javascript:');
  });

  it('mantiene el orden estable de la respuesta del backend (no reordena)', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [ADMIN_OPTION, EMPLOYEE_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    await screen.findByText('Coke');
    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names[0]).toMatch(/administrador/i);
    expect(names[1]).toMatch(/coke/i);
  });

  it('funciona con una sola identidad', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [ADMIN_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /cuenta de administrador/i })).toBeEnabled();
  });

  it('un administrador sin empleado asociado (colorHex null) se renderiza sin romper', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [ADMIN_OPTION] });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: /cuenta de administrador/i });
    // El avatar del admin es un escudo, no una inicial sobre un color del perfil.
    expect(card.querySelector('[data-avatar]')).toBeNull();
  });

  it('soporta nombres largos sin truncar el nombre accesible', async () => {
    // Fixture sintético (no es una persona real): solo mide el ajuste de línea.
    const longName = 'Identidad sintética de prueba con un nombre visible extremadamente largo';
    fetchLoginOptionsMock.mockResolvedValue({
      options: [{ ...EMPLOYEE_OPTION, displayName: longName }],
    });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const card = await screen.findByRole('button', { name: longName });
    expect(card).toHaveTextContent(longName);
  });

  it('varias identidades: cada una es un botón propio dentro de una lista', async () => {
    fetchLoginOptionsMock.mockResolvedValue({
      options: [
        ADMIN_OPTION,
        EMPLOYEE_OPTION,
        { ...EMPLOYEE_OPTION, id: 'user-2', displayName: 'Identidad sintética 2' },
      ],
    });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const list = await screen.findByRole('list', { name: /identidades habilitadas/i });
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('las identidades son alcanzables con Tab y se eligen con Enter', async () => {
    fetchLoginOptionsMock.mockResolvedValue({ options: [EMPLOYEE_OPTION] });
    const onSelect = vi.fn();
    render(<IdentitySelector onSelect={onSelect} />);
    await screen.findByText('Coke');

    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: /coke/i })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(EMPLOYEE_OPTION);
  });

  it('ADMIN con nombre propio: etiqueta visible "Administrador"; con el nombre genérico no se repite', async () => {
    fetchLoginOptionsMock.mockResolvedValue({
      options: [
        ADMIN_OPTION,
        { ...ADMIN_OPTION, id: 'admin-2', displayName: 'Identidad sintética admin' },
      ],
    });
    render(<IdentitySelector onSelect={vi.fn()} />);

    const named = await screen.findByRole('button', { name: /identidad sintética admin/i });
    expect(within(named).getByText('Administrador')).toBeInTheDocument();
    const generic = screen.getByRole('button', {
      name: /^administrador, cuenta de administrador$/i,
    });
    expect(within(generic).getAllByText('Administrador')).toHaveLength(1);
  });
});
