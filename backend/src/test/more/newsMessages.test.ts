import { describe, expect, it } from 'vitest';
import {
  assertCanDeleteNewsMessage,
  lostEditRaceError,
  newsMessagePermissions,
  shouldWriteNewsMessageEdit,
} from '../../more/newsMessages';
import type { TaskActor } from '../../tasks/tasksService';

/** Reglas puras de edición/eliminación de mensajes de Novedades. Ids sintéticos. */

const AUTHOR: TaskActor = { userId: 'u-author', role: 'EMPLOYEE', employeeId: 'emp-author' };
const OTHER: TaskActor = { userId: 'u-other', role: 'EMPLOYEE', employeeId: 'emp-other' };
const ADMIN: TaskActor = { userId: 'u-admin', role: 'ADMIN', employeeId: null };
const live = { authorUserId: 'u-author', version: 2, deletedAt: null, text: 'Texto vigente' };

describe('permisos de mensajes de Novedades', () => {
  it('el autor edita y elimina; otro EMPLOYEE no; un ADMIN ajeno solo elimina', () => {
    expect(newsMessagePermissions(AUTHOR, 'u-author', false)).toEqual({
      canEdit: true,
      canDelete: true,
    });
    expect(newsMessagePermissions(OTHER, 'u-author', false)).toEqual({
      canEdit: false,
      canDelete: false,
    });
    expect(newsMessagePermissions(ADMIN, 'u-author', false)).toEqual({
      canEdit: false,
      canDelete: true,
    });
  });

  it('un ADMIN autor edita y elimina lo propio', () => {
    expect(newsMessagePermissions(ADMIN, 'u-admin', false)).toEqual({
      canEdit: true,
      canDelete: true,
    });
  });

  it('sin autor de carga (seed): nadie edita, ni siquiera por coincidencia de empleado; ADMIN modera', () => {
    expect(newsMessagePermissions(AUTHOR, null, false)).toEqual({
      canEdit: false,
      canDelete: false,
    });
    expect(newsMessagePermissions(ADMIN, null, false)).toEqual({
      canEdit: false,
      canDelete: true,
    });
  });

  it('un mensaje eliminado no ofrece ninguna acción', () => {
    expect(newsMessagePermissions(AUTHOR, 'u-author', true)).toEqual({
      canEdit: false,
      canDelete: false,
    });
    expect(newsMessagePermissions(ADMIN, 'u-author', true)).toEqual({
      canEdit: false,
      canDelete: false,
    });
  });
});

describe('decisión de edición', () => {
  it('solo el autor; un ADMIN ajeno o una novedad sin autor de carga → 403', () => {
    for (const [actor, state] of [
      [OTHER, live],
      [ADMIN, live],
      [AUTHOR, { ...live, authorUserId: null }],
    ] as const) {
      expect(() => shouldWriteNewsMessageEdit(actor, state, { text: 'Nuevo', version: 2 })).toThrow(
        expect.objectContaining({ statusCode: 403 }),
      );
    }
  });

  it('eliminado → 409 NEWS_MESSAGE_DELETED (aunque el texto coincida)', () => {
    const deleted = { ...live, deletedAt: new Date() };
    for (const text of ['Nuevo', live.text]) {
      expect(() => shouldWriteNewsMessageEdit(AUTHOR, deleted, { text, version: 2 })).toThrow(
        expect.objectContaining({ code: 'NEWS_MESSAGE_DELETED' }),
      );
    }
  });

  it('sin cambios efectivos no escribe, aunque la pantalla tuviera una versión vieja', () => {
    expect(shouldWriteNewsMessageEdit(AUTHOR, live, { text: live.text, version: 2 })).toBe(false);
    expect(shouldWriteNewsMessageEdit(AUTHOR, live, { text: live.text, version: 1 })).toBe(false);
  });

  it('texto nuevo con versión vieja → 409 NEWS_MESSAGE_VERSION_CONFLICT; con la vigente, escribe', () => {
    expect(() => shouldWriteNewsMessageEdit(AUTHOR, live, { text: 'Nuevo', version: 1 })).toThrow(
      expect.objectContaining({ code: 'NEWS_MESSAGE_VERSION_CONFLICT' }),
    );
    expect(shouldWriteNewsMessageEdit(AUTHOR, live, { text: 'Nuevo', version: 2 })).toBe(true);
  });

  it('una carrera perdida se informa como eliminado o como conflicto de versión', () => {
    expect(lostEditRaceError({ deletedAt: new Date() })).toMatchObject({
      code: 'NEWS_MESSAGE_DELETED',
    });
    expect(lostEditRaceError({ deletedAt: null })).toMatchObject({
      code: 'NEWS_MESSAGE_VERSION_CONFLICT',
    });
  });
});

describe('decisión de eliminación', () => {
  it('autor o ADMIN; otro EMPLOYEE → 403', () => {
    expect(() => assertCanDeleteNewsMessage(AUTHOR, live)).not.toThrow();
    expect(() => assertCanDeleteNewsMessage(ADMIN, live)).not.toThrow();
    expect(() => assertCanDeleteNewsMessage(ADMIN, { ...live, authorUserId: null })).not.toThrow();
    expect(() => assertCanDeleteNewsMessage(OTHER, live)).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
    expect(() => assertCanDeleteNewsMessage(AUTHOR, { ...live, authorUserId: null })).toThrow(
      expect.objectContaining({ statusCode: 403 }),
    );
  });
});
