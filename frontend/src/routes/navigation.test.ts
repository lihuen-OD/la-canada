import { describe, expect, it } from 'vitest';
import type { SystemRole } from '../api/types';
import { APP_ROUTES, getVisibleNavigation } from './navigation';

const as = (role: SystemRole) => (required: SystemRole) => required === role;

describe('navigation', () => {
  it('ADMIN: Inicio y Usuarios, en ese orden', () => {
    expect(getVisibleNavigation(as('ADMIN')).map((item) => item.path)).toEqual([
      '/',
      '/admin/users',
    ]);
  });

  it('EMPLOYEE: solo Inicio', () => {
    expect(getVisibleNavigation(as('EMPLOYEE')).map((item) => item.path)).toEqual(['/']);
  });

  it('la ruta de usuarios exige exactamente el rol ADMIN (mismo valor que usa RequireRole)', () => {
    expect(APP_ROUTES.adminUsers.requiredRole).toBe('ADMIN');
  });

  it('no declara ningún módulo que todavía no existe', () => {
    const paths = Object.values(APP_ROUTES).map((route) => route.path);
    expect(paths).toEqual(['/', '/admin/users']);
  });
});
