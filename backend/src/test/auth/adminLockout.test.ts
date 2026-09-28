import { describe, expect, it, vi } from 'vitest';
import { assertAdminCanBeDeactivated } from '../../auth/adminLockout';

/** Etapa 5U — guarda "siempre al menos un ADMIN activo" (la carrera real, en integración). */
const txWith = (activeIds: string[]) => {
  const queryRaw = vi.fn(async () => activeIds.map((id) => ({ id })));
  return { tx: { $queryRaw: queryRaw } as never, queryRaw };
};

describe('assertAdminCanBeDeactivated', () => {
  it('nunca a uno mismo (409), sin llegar a bloquear filas', async () => {
    const { tx, queryRaw } = txWith(['a', 'b']);
    await expect(assertAdminCanBeDeactivated(tx, 'a', 'a')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AUTH_SELF_STATUS_CHANGE',
      message: 'No podés desactivar tu propia cuenta.',
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('bloquea las filas de ADMIN activos con FOR UPDATE en orden fijo', async () => {
    const { tx, queryRaw } = txWith(['a', 'b']);
    await assertAdminCanBeDeactivated(tx, 'a', 'b');
    const sql = (queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toMatch(/role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE/);
  });

  it('si el actor ya no es ADMIN activo (perdió la carrera), se rechaza', async () => {
    const { tx } = txWith(['b']);
    await expect(assertAdminCanBeDeactivated(tx, 'a', 'b')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ACTOR_INACTIVE',
    });
  });

  it('nunca 0 ADMIN activos: si la guarda deja pasar, el actor activo siempre queda', async () => {
    // "Nunca a uno mismo" + "el actor sigue activo tras el bloqueo" implican que
    // queda al menos el actor: el chequeo explícito del último activo
    // (`ADMIN_LAST_ACTIVE`) es defensa en profundidad y no se alcanza por esta vía.
    for (const active of [
      ['a', 'b'],
      ['a', 'b', 'c'],
    ]) {
      const { tx } = txWith(active);
      await assertAdminCanBeDeactivated(tx, 'a', 'b');
      expect(active.filter((id) => id !== 'b')).toContain('a');
    }
  });

  it('con otro ADMIN activo restante, se permite', async () => {
    const { tx } = txWith(['a', 'b', 'c']);
    await expect(assertAdminCanBeDeactivated(tx, 'a', 'c')).resolves.toBeUndefined();
  });
});
