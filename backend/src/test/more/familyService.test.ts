import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Etapa 5F con un Prisma simulado mínimo: 👤 perfil personal y 👨‍👩‍👧‍👦 familia
 * del usuario sin Employee (propietario siempre de la sesión), cumpleaños
 * derivados vs. manuales en Eventos (orígenes, duplicados, fuentes inactivas)
 * y el backfill de Vicky/Felicitas. La SQL real se prueba contra `demo` en
 * `family.integration.test.ts`.
 */
const db = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    user: { findMany: fn() },
    userProfile: { findUnique: fn(), upsert: fn(), findMany: fn(), count: fn() },
    recurringBirthday: {
      findMany: fn(),
      findFirst: fn(),
      create: fn(),
      update: fn(),
      updateMany: fn(),
      deleteMany: fn(),
      count: fn(),
    },
    event: { findMany: fn(), findFirst: fn(), create: fn(), update: fn(), count: fn() },
    employeeProfile: { findMany: fn(), count: fn() },
    employeeChild: { findMany: fn(), count: fn() },
    animal: { findMany: fn(), count: fn() },
    idempotencyRecord: { findUnique: fn(), create: fn(), update: fn() },
    auditLog: { create: fn() },
    $transaction: fn(),
    $queryRaw: fn(),
  };
});
vi.mock('../../lib/prisma', () => ({ prisma: db }));

import { recurringBirthdaySeeds } from '../../../prisma/seed-data/recurringBirthdays';
import type { TaskActor } from '../../tasks/tasksService';
import {
  createFamilyMember,
  deleteFamilyMember,
  getPersonalProfile,
  listMyFamily,
  setFamilyMemberActive,
  updateFamilyMember,
  updatePersonalProfile,
} from '../../more/familyService';
import { getMyProfile } from '../../more/profileService';
import { createEvent, listEvents, loadBirthdayInputs, updateEvent } from '../../more/eventsService';
import { FAMILY_SEED_SLUGS, backfillAdminFamily } from '../../more/familyBackfill';

const META = { ipAddress: null, userAgent: 'vitest' };
const ADMIN: TaskActor = { userId: 'user-a', role: 'ADMIN', employeeId: null };
const EMPLOYEE: TaskActor = { userId: 'user-e', role: 'EMPLOYEE', employeeId: 'emp-1' };
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-09-28T15:00:00Z');
const audits = () => db.auditLog.create.mock.calls.map((call) => call[0].data);

const member = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  slug: null,
  personLabel: 'Ana',
  relation: 'CHILD',
  month: 5,
  day: 4,
  birthYear: 2010,
  active: true,
  ...overrides,
});

function emptySources() {
  db.recurringBirthday.findMany.mockResolvedValue([]);
  db.userProfile.findMany.mockResolvedValue([]);
  db.employeeProfile.findMany.mockResolvedValue([]);
  db.employeeChild.findMany.mockResolvedValue([]);
  db.animal.findMany.mockResolvedValue([]);
  db.event.findMany.mockResolvedValue([]);
  db.event.count.mockResolvedValue(0);
}

beforeEach(() => {
  for (const group of Object.values(db)) {
    if (typeof group === 'function') group.mockReset();
    else for (const method of Object.values(group)) method.mockReset();
  }
  db.$transaction.mockImplementation((run: (tx: typeof db) => unknown) => run(db));
  db.$queryRaw.mockResolvedValue([{ id: ADMIN.userId }]);
  db.auditLog.create.mockResolvedValue({});
  emptySources();
});

describe('👤 perfil personal (usuario sin Employee)', () => {
  it('ADMIN sin Employee obtiene su perfil (vacío si nunca lo guardó)', async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    await expect(getMyProfile(ADMIN, NOW)).resolves.toEqual({
      kind: 'personal',
      profile: { displayName: null, birthDate: null },
    });
    expect(db.userProfile.findUnique.mock.calls[0]?.[0].where).toEqual({ userId: 'user-a' });
  });

  it('guarda su fecha con upsert por la sesión; la auditoría lista campos, nunca valores', async () => {
    db.userProfile.findUnique.mockResolvedValue(null);
    db.userProfile.upsert.mockResolvedValue({
      displayName: 'Nombre sintético',
      birthDate: new Date('1985-07-20T00:00:00Z'),
    });
    const saved = await updatePersonalProfile(
      ADMIN,
      { displayName: 'Nombre sintético', birthDate: '1985-07-20' },
      META,
      NOW,
    );
    expect(saved.profile).toEqual({ displayName: 'Nombre sintético', birthDate: '1985-07-20' });
    expect(db.userProfile.upsert.mock.calls[0]?.[0].where).toEqual({ userId: 'user-a' });
    const audit = audits()[0];
    expect(audit).toMatchObject({ action: 'profile.personal_updated', entityId: 'user-a' });
    expect(audit.newState.changedFields).toEqual(['displayName', 'birthDate']);
    expect(JSON.stringify(audit)).not.toMatch(/1985|Nombre sintético/);
  });

  it('fecha futura → 400; un EMPLOYEE con ficha no usa el perfil personal', async () => {
    await expect(
      updatePersonalProfile(
        ADMIN,
        { displayName: 'Nombre sintético', birthDate: '2026-09-29' },
        META,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(getPersonalProfile(EMPLOYEE)).rejects.toMatchObject({
      code: 'FAMILY_USES_EMPLOYEE_PROFILE',
    });
    expect(db.userProfile.upsert).not.toHaveBeenCalled();
  });
});

describe('👨‍👩‍👧‍👦 Mi familia — CRUD del propietario de la sesión', () => {
  it.each([
    ['PARTNER', 'Pareja sintética', '1984-02-01'],
    ['CHILD', 'Hijo sintético', '2015-11-30'],
    ['FAMILY', 'Familiar sintético', '--08-15'],
  ] as const)('crea %s con el propietario de la sesión', async (relation, name, birthDate) => {
    db.recurringBirthday.findFirst.mockResolvedValue(null);
    db.recurringBirthday.create.mockImplementation(async ({ data }) => ({
      ...member(),
      personLabel: data.personLabel,
      relation: data.relation,
      month: data.month,
      day: data.day,
      birthYear: data.birthYear,
    }));
    const result = await createFamilyMember(
      ADMIN,
      { name, relation, birthDate },
      META,
      undefined,
      NOW,
    );
    const data = db.recurringBirthday.create.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({ ownerUserId: 'user-a', relation, personLabel: name });
    expect(data.slug).toBeUndefined();
    expect(result.kind === 'created' && result.body.member.birthDate).toBe(birthDate);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1); // bloqueo de la familia
    expect(audits()[0]).toMatchObject({
      action: 'family.member_created',
      newState: { ownerUserId: 'user-a', relation },
    });
  });

  it('sin año: no inventa uno y no calcula edad', async () => {
    db.recurringBirthday.findFirst.mockResolvedValue(null);
    db.recurringBirthday.create.mockResolvedValue(member({ birthYear: null }));
    const result = await createFamilyMember(
      ADMIN,
      { name: 'Ana', relation: 'CHILD', birthDate: '--05-04' },
      META,
      undefined,
      NOW,
    );
    expect(db.recurringBirthday.create.mock.calls[0]?.[0].data.birthYear).toBeNull();
    expect(result.kind === 'created' && result.body.member).toMatchObject({
      birthDate: '--05-04',
      age: null,
    });
  });

  it('doble carga (mismo nombre sin mayúsculas y misma fecha) → 409; el chequeo es por propietario', async () => {
    db.recurringBirthday.findFirst.mockResolvedValue({ id: 'otro' });
    await expect(
      createFamilyMember(
        ADMIN,
        { name: 'ANA', relation: 'CHILD', birthDate: '2010-05-04' },
        META,
        undefined,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'FAMILY_MEMBER_DUPLICATE', statusCode: 409 });
    const where = db.recurringBirthday.findFirst.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({
      ownerUserId: 'user-a',
      personLabel: { equals: 'ANA', mode: 'insensitive' },
      month: 5,
      day: 4,
      OR: [{ birthYear: null }, { birthYear: 2010 }],
    });
    expect(db.recurringBirthday.create).not.toHaveBeenCalled();
  });

  it('edita nombre, relación y fecha; la auditoría no guarda valores', async () => {
    db.recurringBirthday.findFirst.mockResolvedValueOnce(member()).mockResolvedValueOnce(null);
    db.recurringBirthday.update.mockImplementation(async ({ data }) => ({ ...member(), ...data }));
    const { member: after } = await updateFamilyMember(
      ADMIN,
      ID,
      { name: 'Ana María', relation: 'FAMILY', birthDate: '2010-05-05' },
      META,
      NOW,
    );
    expect(after).toMatchObject({ name: 'Ana María', relation: 'FAMILY', birthDate: '2010-05-05' });
    expect(db.recurringBirthday.findFirst.mock.calls[0]?.[0].where).toEqual({
      id: ID,
      ownerUserId: 'user-a',
    });
    const audit = audits()[0];
    expect(audit.newState.changedFields).toEqual(['name', 'relation', 'birthDate']);
    expect(JSON.stringify(audit)).not.toMatch(/Ana|2010/);
  });

  it('un id de otra familia se trata como inexistente (404) y no se escribe nada', async () => {
    db.recurringBirthday.findFirst.mockResolvedValue(null);
    await expect(updateFamilyMember(ADMIN, ID, { name: 'x' }, META, NOW)).rejects.toMatchObject({
      code: 'FAMILY_MEMBER_NOT_FOUND',
    });
    await expect(setFamilyMemberActive(ADMIN, ID, false, META, NOW)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(deleteFamilyMember(ADMIN, ID, META)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.recurringBirthday.update).not.toHaveBeenCalled();
    expect(db.recurringBirthday.updateMany).not.toHaveBeenCalled();
    expect(db.recurringBirthday.deleteMany).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it('desactivar y reactivar auditan; repetir el mismo estado no escribe', async () => {
    db.recurringBirthday.findFirst.mockResolvedValue(member());
    db.recurringBirthday.updateMany.mockResolvedValue({ count: 1 });
    const off = await setFamilyMemberActive(ADMIN, ID, false, META, NOW);
    expect(off.member.active).toBe(false);
    expect(db.recurringBirthday.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: ID, ownerUserId: 'user-a', active: true },
      data: { active: false },
    });
    db.recurringBirthday.findFirst.mockResolvedValue(member({ active: false }));
    await setFamilyMemberActive(ADMIN, ID, true, META, NOW);
    expect(audits().map((a) => a.action)).toEqual([
      'family.member_deactivated',
      'family.member_reactivated',
    ]);
    await setFamilyMemberActive(ADMIN, ID, false, META, NOW);
    expect(db.recurringBirthday.updateMany).toHaveBeenCalledTimes(2);
  });

  it('eliminar: snapshot mínimo antes de borrar; nunca toca Event; los del seed solo se desactivan', async () => {
    db.recurringBirthday.findFirst.mockResolvedValue(member());
    db.recurringBirthday.deleteMany.mockResolvedValue({ count: 1 });
    await deleteFamilyMember(ADMIN, ID, META);
    expect(audits()[0]).toMatchObject({
      action: 'family.member_deleted',
      previousState: { ownerUserId: 'user-a', name: 'Ana', relation: 'CHILD' },
    });
    expect(JSON.stringify(audits()[0])).not.toMatch(/2010|birthDate|birthYear/);
    expect(db.recurringBirthday.deleteMany.mock.calls[0]?.[0]).toEqual({
      where: { id: ID, ownerUserId: 'user-a', slug: null },
    });
    expect(db.event.findMany).not.toHaveBeenCalled();

    db.recurringBirthday.findFirst.mockResolvedValue(member({ slug: 'vicky' }));
    await expect(deleteFamilyMember(ADMIN, ID, META)).rejects.toMatchObject({
      code: 'FAMILY_MEMBER_SEEDED',
    });
    expect(db.recurringBirthday.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('un EMPLOYEE con ficha de equipo no carga familia acá (sus hijos siguen en EmployeeChild)', async () => {
    await expect(listMyFamily(EMPLOYEE)).rejects.toMatchObject({
      code: 'FAMILY_USES_EMPLOYEE_PROFILE',
    });
    await expect(
      createFamilyMember(EMPLOYEE, { name: 'x', relation: 'CHILD', birthDate: '--01-01' }, META),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(db.recurringBirthday.findMany).not.toHaveBeenCalled();
  });

  it('listar: solo la familia de la sesión, con inactivos (para reactivar)', async () => {
    db.recurringBirthday.findMany.mockResolvedValue([
      member({
        slug: 'vicky',
        personLabel: 'Vicky',
        relation: 'FAMILY',
        birthYear: null,
        month: 3,
        day: 10,
      }),
      member({ active: false }),
    ]);
    const { family } = await listMyFamily(ADMIN, NOW);
    expect(db.recurringBirthday.findMany.mock.calls[0]?.[0].where).toEqual({
      ownerUserId: 'user-a',
    });
    expect(family[0]).toMatchObject({
      name: 'Vicky',
      birthDate: '--03-10',
      seeded: true,
      age: null,
    });
    expect(family[1]).toMatchObject({ active: false, age: { years: 16 } });
  });
});

describe('📅 Eventos — cumpleaños derivados con origen explícito', () => {
  function sources() {
    db.recurringBirthday.findMany.mockResolvedValue([
      {
        id: 'rb-v',
        personLabel: 'Vicky',
        month: 3,
        day: 10,
        relationship: 'familia',
        relation: 'FAMILY',
        ownerUserId: 'user-a',
      },
      {
        id: 'rb-g',
        personLabel: 'Global',
        month: 1,
        day: 2,
        relationship: 'familia',
        relation: null,
        ownerUserId: null,
      },
    ]);
    db.userProfile.findMany.mockResolvedValue([
      {
        id: 'up-1',
        userId: 'user-a',
        displayName: null,
        birthDate: new Date('1985-09-29T00:00:00Z'),
      },
    ]);
    db.employeeProfile.findMany.mockResolvedValue([
      {
        employeeId: 'emp-1',
        birthDate: new Date('1990-10-01T00:00:00Z'),
        employee: { displayName: 'Coke' },
      },
    ]);
    db.employeeChild.findMany.mockResolvedValue([
      {
        id: 'ch-1',
        name: 'Hijo',
        birthDate: new Date('2020-01-15T00:00:00Z'),
        employeeId: 'emp-1',
        employee: { displayName: 'Coke' },
      },
    ]);
    db.animal.findMany.mockResolvedValue([
      { id: 'an-1', name: 'Firulais', birthDate: new Date('2019-02-28T00:00:00Z') },
    ]);
  }

  it('cada fuente aparece una sola vez con su origen; fuentes inactivas se filtran en la consulta', async () => {
    sources();
    const result = await listEvents(ADMIN, { pastPage: 1, pastPageSize: 20 }, NOW);
    const birthdays = result.upcoming.filter((item) => item.kind === 'birthday');
    expect(birthdays.map((item) => [item.origin, item.title]).sort()).toEqual(
      [
        ['ANIMAL', 'Cumpleaños de Firulais'],
        ['EMPLOYEE', 'Cumpleaños de Coke'],
        ['EMPLOYEE_CHILD', 'Cumpleaños de Hijo'],
        ['GLOBAL_RECURRING', 'Cumpleaños de Global'],
        ['USER_FAMILY', 'Cumpleaños de Vicky'],
        ['USER_PROFILE', 'Cumpleaños del administrador'],
      ].sort(),
    );
    expect(new Set(birthdays.map((item) => item.id)).size).toBe(birthdays.length);
    expect(db.recurringBirthday.findMany.mock.calls[0]?.[0].where).toEqual({
      active: true,
      OR: [{ ownerUserId: null }, { owner: { status: 'ACTIVE' } }],
    });
    expect(db.userProfile.findMany.mock.calls[0]?.[0].where).toEqual({
      birthDate: { not: null },
      user: { status: 'ACTIVE', employeeId: null },
    });
    expect(db.animal.findMany.mock.calls[0]?.[0].where).toMatchObject({ active: true });
    const own = birthdays.find((item) => item.origin === 'USER_PROFILE');
    expect(own).toMatchObject({
      daysUntil: 1,
      sourceRef: { kind: 'MY_PROFILE' },
      note: 'Administración',
    });
    // Consultas fijas: una por fuente, sin importar cuántos cumpleaños haya.
    for (const group of [
      db.recurringBirthday,
      db.userProfile,
      db.employeeProfile,
      db.employeeChild,
      db.animal,
    ]) {
      expect(group.findMany).toHaveBeenCalledTimes(1);
    }
  });

  it('el EMPLOYEE ve los mismos cumpleaños pero sin enlaces a datos ajenos ni ids de usuario', async () => {
    sources();
    const result = await listEvents(
      { userId: 'user-x', role: 'EMPLOYEE', employeeId: 'emp-9' },
      { pastPage: 1, pastPageSize: 20 },
      NOW,
    );
    const body = JSON.stringify(result);
    expect(body).not.toMatch(/user-a|ownerUserId|employeeId|birthYear|1985/);
    const refs = Object.fromEntries(
      result.upcoming.filter((i) => i.kind === 'birthday').map((i) => [i.origin, i.sourceRef]),
    );
    expect(refs).toMatchObject({
      USER_FAMILY: null,
      USER_PROFILE: null,
      EMPLOYEE: null,
      ANIMAL: { kind: 'PET', id: 'an-1' },
    });
  });

  it('los eventos manuales llevan origin MANUAL; leer no crea filas', async () => {
    db.event.findMany.mockResolvedValueOnce([
      {
        id: 'ev-1',
        title: 'Cumpleaños de Tía',
        date: new Date('2026-10-02T00:00:00Z'),
        type: 'BIRTHDAY',
        note: null,
      },
    ]);
    const result = await listEvents(ADMIN, { pastPage: 1, pastPageSize: 20 }, NOW);
    expect(result.upcoming[0]).toMatchObject({ kind: 'event', origin: 'MANUAL', id: 'ev-1' });
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it('Benjamín no está en el seed y ninguna fuente lo agrega', async () => {
    expect(recurringBirthdaySeeds.some((seed) => /Benjam/.test(seed.personLabel))).toBe(false);
    sources();
    const inputs = await loadBirthdayInputs();
    expect(inputs.some((input) => /Benjam/.test(input.name ?? ''))).toBe(false);
  });
});

describe('🎂 cumpleaños manual — duplicados', () => {
  const body = { title: 'Cumpleaños de Vicky', date: '2027-03-10', type: 'BIRTHDAY' as const };

  it('derivado activo equivalente → 409 en español, sin crear la fila', async () => {
    db.recurringBirthday.findMany.mockResolvedValue([
      {
        id: 'rb-v',
        personLabel: 'Vicky',
        month: 3,
        day: 10,
        relationship: 'familia',
        relation: 'FAMILY',
        ownerUserId: 'user-a',
      },
    ]);
    await expect(
      createEvent(ADMIN, { ...body, title: '🎂 cumpleaños de  VICKY' }, META, NOW),
    ).rejects.toMatchObject({
      code: 'EVENT_BIRTHDAY_DERIVED',
      statusCode: 409,
      message:
        'Este cumpleaños ya se genera automáticamente desde el perfil correspondiente. Editalo desde su perfil para evitar duplicados.',
    });
    expect(db.event.create).not.toHaveBeenCalled();
  });

  it('manual equivalente vigente → 409 en español', async () => {
    db.event.findMany.mockResolvedValue([{ title: 'cumpleaños de vicky' }]);
    await expect(createEvent(ADMIN, body, META, NOW)).rejects.toMatchObject({
      code: 'EVENT_BIRTHDAY_DUPLICATE',
      message: 'Ya existe un cumpleaños con este nombre y fecha.',
    });
    expect(db.event.findMany.mock.calls[0]?.[0].where).toMatchObject({
      type: 'BIRTHDAY',
      deletedAt: null,
    });
  });

  it('otro nombre u otra fecha no es duplicado; otros tipos no se comparan', async () => {
    db.recurringBirthday.findMany.mockResolvedValue([
      {
        id: 'rb-v',
        personLabel: 'Vicky',
        month: 3,
        day: 10,
        relationship: null,
        relation: 'FAMILY',
        ownerUserId: 'user-a',
      },
    ]);
    db.event.create.mockResolvedValue({
      id: 'ev-n',
      title: 'Cumpleaños de Vicky',
      date: new Date('2027-03-11T00:00:00Z'),
      type: 'BIRTHDAY',
      note: null,
    });
    await createEvent(ADMIN, { ...body, date: '2027-03-11' }, META, NOW);
    db.event.create.mockResolvedValue({
      id: 'ev-v',
      title: 'Visita de Vicky',
      date: new Date('2027-03-10T00:00:00Z'),
      type: 'VISIT',
      note: null,
    });
    db.event.findMany.mockClear();
    await createEvent(
      ADMIN,
      { title: 'Visita de Vicky', date: '2027-03-10', type: 'VISIT' },
      META,
      NOW,
    );
    expect(db.event.findMany).not.toHaveBeenCalled();
    expect(db.event.create).toHaveBeenCalledTimes(2);
  });

  it('editar un manual hacia un duplicado también se rechaza; se excluye a sí mismo', async () => {
    db.event.findFirst.mockResolvedValue({
      title: 'Cumpleaños de Tía',
      date: new Date('2027-03-10T00:00:00Z'),
      type: 'BIRTHDAY',
    });
    db.event.findMany.mockResolvedValue([{ title: 'Cumpleaños de Vicky' }]);
    await expect(
      updateEvent(ADMIN, ID, { title: 'Cumpleaños de Vicky' }, META, NOW),
    ).rejects.toMatchObject({
      code: 'EVENT_BIRTHDAY_DUPLICATE',
    });
    expect(db.event.findMany.mock.calls[0]?.[0].where).toMatchObject({ id: { not: ID } });
  });

  it('EMPLOYEE no administra eventos manuales', async () => {
    await expect(createEvent(EMPLOYEE, body, META, NOW)).rejects.toMatchObject({ statusCode: 403 });
    await expect(updateEvent(EMPLOYEE, ID, { title: 'x' }, META, NOW)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(db.event.findMany).not.toHaveBeenCalled();
  });
});

describe('🔁 backfill de Vicky y Felicitas', () => {
  const seedRows = (owner: string | null) =>
    FAMILY_SEED_SLUGS.map((slug) => ({ id: `rb-${slug}`, slug, ownerUserId: owner }));

  it('las claves naturales coinciden con el seed real', () => {
    expect([...FAMILY_SEED_SLUGS].sort()).toEqual(
      recurringBirthdaySeeds
        .filter((s) => s.relationship === 'familia')
        .map((s) => s.slug)
        .sort(),
    );
  });

  it.each([
    [[], /No hay ningún ADMIN activo/],
    [
      [
        { id: 'a1', employeeId: null },
        { id: 'a2', employeeId: null },
      ],
      /más de un ADMIN/,
    ],
  ])('se detiene sin escribir con %j admins', async (admins, message) => {
    db.user.findMany.mockResolvedValue(admins);
    await expect(backfillAdminFamily()).rejects.toThrow(message);
    expect(db.recurringBirthday.updateMany).not.toHaveBeenCalled();
    expect(db.user.findMany.mock.calls[0]?.[0].where).toEqual({ role: 'ADMIN', status: 'ACTIVE' });
    expect(JSON.stringify(db.user.findMany.mock.calls[0]?.[0])).not.toMatch(/username/);
  });

  it('asocia con FAMILY la primera vez y no cambia nada la segunda', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'user-a', employeeId: null }]);
    db.recurringBirthday.updateMany.mockResolvedValue({ count: 1 });
    const labels = FAMILY_SEED_SLUGS.map((slug) => ({
      id: `rb-${slug}`,
      slug,
      personLabel: slug === 'vicky' ? 'Vicky' : 'Felicitas',
      active: true,
    }));
    const derived = labels.map((row) => ({
      id: row.id,
      personLabel: row.personLabel,
      month: 3,
      day: 10,
      relationship: 'familia',
      relation: 'FAMILY',
      ownerUserId: 'user-a',
    }));
    db.recurringBirthday.findMany
      .mockResolvedValueOnce(seedRows(null))
      .mockResolvedValueOnce(derived)
      .mockResolvedValueOnce(labels);
    const first = await backfillAdminFamily();
    expect(first.associated).toEqual(['felicitas', 'vicky']);
    expect(first.occurrences).toEqual({ vicky: 1, felicitas: 1 });
    expect(db.recurringBirthday.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: 'rb-vicky', ownerUserId: null },
      data: { ownerUserId: 'user-a', relation: 'FAMILY' },
    });

    db.recurringBirthday.findMany
      .mockResolvedValueOnce(seedRows('user-a'))
      .mockResolvedValueOnce(derived)
      .mockResolvedValueOnce(labels);
    const second = await backfillAdminFamily();
    expect(second).toMatchObject({ associated: [], unchanged: ['felicitas', 'vicky'] });
    expect(db.recurringBirthday.updateMany).toHaveBeenCalledTimes(2);
  });

  it('una fila asociada a OTRO usuario detiene todo sin escribir', async () => {
    db.user.findMany.mockResolvedValue([{ id: 'user-a', employeeId: null }]);
    db.recurringBirthday.findMany.mockResolvedValueOnce(seedRows('user-z'));
    await expect(backfillAdminFamily()).rejects.toThrow(/otro usuario/);
    expect(db.recurringBirthday.updateMany).not.toHaveBeenCalled();
  });
});
