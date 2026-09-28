import { describe, expect, it } from 'vitest';
import { loadedVisibleName, resolveVisibleName } from '../../auth/authService';

/** Etapa 5F — el nombre visible nunca es el `username` técnico. */
describe('nombre visible de la sesión', () => {
  it('Employee → perfil personal → "Administrador"', () => {
    expect(
      resolveVisibleName({
        employee: { displayName: 'Coke' },
        personalProfile: { displayName: 'Otro' },
      }),
    ).toBe('Coke');
    expect(
      resolveVisibleName({ employee: null, personalProfile: { displayName: 'Nombre sintético' } }),
    ).toBe('Nombre sintético');
    expect(resolveVisibleName({ employee: null, personalProfile: { displayName: null } })).toBe(
      'Administrador',
    );
    expect(resolveVisibleName({ employee: null, personalProfile: null })).toBe('Administrador');
  });

  it('para la sesión, sin nombre cargado es null (el frontend decide el fallback)', () => {
    expect(loadedVisibleName({ employee: null, personalProfile: null })).toBeNull();
    expect(loadedVisibleName({ employee: null, personalProfile: { displayName: 'Ana' } })).toBe(
      'Ana',
    );
  });

  it('no acepta ni lee username', () => {
    const user = { employee: null, personalProfile: null, username: 'admin.tecnico' };
    expect(resolveVisibleName(user)).not.toContain('admin.tecnico');
  });
});
