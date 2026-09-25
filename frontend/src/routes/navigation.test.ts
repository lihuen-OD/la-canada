import { describe, expect, it } from 'vitest';
import type { SystemRole } from '../api/types';
import { APP_ROUTES, getVisibleNavigation } from './navigation';

const as = (role: SystemRole) => (required: SystemRole) => required === role;

describe('navigation', () => {
  it.each(['ADMIN', 'EMPLOYEE'] as const)(
    '%s: la barra del prototipo — Inicio, Tareas, Stock, Gallinero, Mascotas y Más',
    (role) => {
      expect(getVisibleNavigation(as(role)).map((item) => item.path)).toEqual([
        '/',
        '/tasks',
        '/stock',
        '/chicken-coop',
        '/pets',
        '/more',
      ]);
    },
  );

  it('Usuarios no es un destino de la barra: se abre desde Más → Configuración, que queda activo', () => {
    expect(APP_ROUTES.more.activeFor).toEqual(['/admin']);
  });

  it('Tareas, Stock, Gallinero y Mascotas no exigen rol: disponibles para todo usuario autenticado', () => {
    expect('requiredRole' in APP_ROUTES.tasks).toBe(false);
    expect('requiredRole' in APP_ROUTES.stock).toBe(false);
    expect('requiredRole' in APP_ROUTES.chickenCoop).toBe(false);
    expect('requiredRole' in APP_ROUTES.pets).toBe(false);
    expect('requiredRole' in APP_ROUTES.more).toBe(false);
  });

  it('la ruta de usuarios exige exactamente el rol ADMIN (mismo valor que usa RequireRole)', () => {
    expect(APP_ROUTES.adminUsers.requiredRole).toBe('ADMIN');
  });

  it('no declara ningún módulo que todavía no existe', () => {
    const paths = Object.values(APP_ROUTES).map((route) => route.path);
    expect(paths).toEqual([
      '/',
      '/tasks',
      '/stock',
      '/chicken-coop',
      '/pets',
      '/more',
      '/admin/users',
    ]);
  });
});
