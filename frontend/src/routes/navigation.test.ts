import { describe, expect, it } from 'vitest';
import type { SystemRole } from '../api/types';
import { APP_ROUTES, getVisibleNavigation } from './navigation';

const as = (role: SystemRole) => (required: SystemRole) => required === role;

describe('navigation', () => {
  it('ADMIN: Inicio, Tareas, Stock, Gallinero, Mascotas y Usuarios, en ese orden (el del prototipo)', () => {
    expect(getVisibleNavigation(as('ADMIN')).map((item) => item.path)).toEqual([
      '/',
      '/tasks',
      '/stock',
      '/chicken-coop',
      '/pets',
      '/admin/users',
    ]);
  });

  it('EMPLOYEE: Inicio, Tareas, Stock, Gallinero y Mascotas (nunca Usuarios)', () => {
    expect(getVisibleNavigation(as('EMPLOYEE')).map((item) => item.path)).toEqual([
      '/',
      '/tasks',
      '/stock',
      '/chicken-coop',
      '/pets',
    ]);
  });

  it('Tareas, Stock, Gallinero y Mascotas no exigen rol: disponibles para todo usuario autenticado', () => {
    expect('requiredRole' in APP_ROUTES.tasks).toBe(false);
    expect('requiredRole' in APP_ROUTES.stock).toBe(false);
    expect('requiredRole' in APP_ROUTES.chickenCoop).toBe(false);
    expect('requiredRole' in APP_ROUTES.pets).toBe(false);
  });

  it('la ruta de usuarios exige exactamente el rol ADMIN (mismo valor que usa RequireRole)', () => {
    expect(APP_ROUTES.adminUsers.requiredRole).toBe('ADMIN');
  });

  it('no declara ningún módulo que todavía no existe', () => {
    const paths = Object.values(APP_ROUTES).map((route) => route.path);
    expect(paths).toEqual(['/', '/tasks', '/stock', '/chicken-coop', '/pets', '/admin/users']);
  });
});
