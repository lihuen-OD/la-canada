import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, within } from '../test/render';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser, SystemRole } from '../api/types';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../auth/useAuth', () => ({ useAuth: useAuthMock }));

import { AppShell } from './AppShell';

const IMPLEMENTED_PATHS = ['/', '/tasks', '/stock', '/chicken-coop', '/pets', '/more'];

function mockUser(role: SystemRole, employee: AuthenticatedUser['employee'] = null) {
  useAuthMock.mockReturnValue({
    user: { id: 'u1', role, status: 'ACTIVE', employee },
    hasRole: (r: SystemRole) => r === role,
    logout: vi.fn(),
  });
}

function renderShell(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<p>contenido de inicio</p>} />
          <Route path="/admin/users" element={<p>contenido de usuarios</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function getNav() {
  return screen.getByRole('navigation', { name: /navegación principal/i });
}

describe('AppShell', () => {
  it('expone landmarks: banner, navegación con nombre y contenido principal', () => {
    mockUser('EMPLOYEE');
    renderShell();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(getNav()).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('contenido de inicio');
    expect(screen.getByRole('link', { name: /saltar al contenido/i })).toHaveAttribute(
      'href',
      '#contenido',
    );
  });

  it('ADMIN: la barra del prototipo — Inicio, Tareas, Stock, Gallinero, Mascotas y Más', () => {
    mockUser('ADMIN');
    renderShell();

    const links = within(getNav()).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/tasks',
      '/stock',
      '/chicken-coop',
      '/pets',
      '/more',
    ]);
    expect(within(getNav()).getByRole('link', { name: 'Tareas' })).toBeInTheDocument();
    expect(within(getNav()).getByRole('link', { name: 'Stock' })).toBeInTheDocument();
  });

  it('📦 Stock: el emoji del prototipo es decorativo y el nombre accesible es el texto', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const link = within(getNav()).getByRole('link', { name: 'Stock' });
    expect(link).toHaveTextContent('📦');
    expect(within(link).getByText('📦')).toHaveAttribute('aria-hidden', 'true');
  });

  it('🐔 Gallinero: el emoji del prototipo es decorativo y el nombre accesible es el texto', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const link = within(getNav()).getByRole('link', { name: 'Gallinero' });
    expect(link).toHaveAttribute('href', '/chicken-coop');
    expect(within(link).getByText('🐔')).toHaveAttribute('aria-hidden', 'true');
  });

  it('☰ Más: el símbolo del prototipo es decorativo y el nombre accesible es el texto', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const link = within(getNav()).getByRole('link', { name: 'Más' });
    expect(link).toHaveAttribute('href', '/more');
    expect(within(link).getByText('☰')).toHaveAttribute('aria-hidden', 'true');
  });

  it('🐾 Mascotas: el emoji del prototipo es decorativo y el nombre accesible es el texto', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const link = within(getNav()).getByRole('link', { name: 'Mascotas' });
    expect(link).toHaveAttribute('href', '/pets');
    expect(within(link).getByText('🐾')).toHaveAttribute('aria-hidden', 'true');
  });

  it('✅ Tareas: el emoji del prototipo es decorativo y el nombre accesible es el texto', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const link = within(getNav()).getByRole('link', { name: 'Tareas' });
    expect(link).toHaveTextContent('✅');
    expect(within(link).getByText('✅')).toHaveAttribute('aria-hidden', 'true');
  });

  it('EMPLOYEE: nunca ve la navegación administrativa', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const nav = getNav();
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument();
  });

  it('solo enlaza destinos implementados — ningún módulo futuro ni deshabilitado', () => {
    mockUser('ADMIN');
    renderShell();

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      if (href.startsWith('#')) continue; // enlace de salto al contenido
      expect(IMPLEMENTED_PATHS).toContain(href);
    }
    const text = document.body.textContent ?? '';
    // Los submódulos de Más viven dentro de /more, no como destinos sueltos de la barra.
    expect(text).not.toMatch(/novedades|eventos|clima|fotos|desempeño/i);
    expect(screen.queryByRole('link', { name: /próximamente/i })).not.toBeInTheDocument();
  });

  it('el destino activo se marca con aria-current="page" (no solo con color)', () => {
    mockUser('ADMIN');
    renderShell('/admin/users');

    const nav = getNav();
    // Usuarios se abre desde Más → Configuración: "Más" queda marcado como destino activo.
    expect(within(nav).getByRole('link', { name: 'Más' })).toHaveAttribute('aria-current', 'page');
    // "Inicio" es un match exacto (`end`): no queda activo en una subruta.
    expect(within(nav).getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
  });

  it('muestra la identidad real de forma discreta y un cierre de sesión con nombre accesible', () => {
    mockUser('EMPLOYEE', { id: 'e1', displayName: 'Coke', colorHex: '#4a7c59' });
    renderShell();

    const header = screen.getByRole('banner');
    expect(within(header).getByText('Coke')).toBeInTheDocument();
    expect(within(header).getByText('Equipo')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument();
  });

  it('un ADMIN sin empleado vinculado se muestra con la etiqueta genérica', () => {
    mockUser('ADMIN');
    renderShell();

    const header = screen.getByRole('banner');
    expect(within(header).getAllByText('Administrador').length).toBeGreaterThan(0);
  });

  it('la marca no es un heading: el único <h1> es el de cada pantalla', () => {
    mockUser('ADMIN');
    renderShell();

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /la cañada, inicio/i })).toHaveAttribute('href', '/');
  });
});
