import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';
import { backfillAdminFamily } from '../../more/familyBackfill';

/**
 * Etapa 5F contra Neon real (`demo`) por HTTP real: 👤 perfil personal y
 * 👨‍👩‍👧‍👦 familia de un usuario sin Employee, cumpleaños derivados vs.
 * manuales en Eventos y el backfill de Vicky/Felicitas. Reglas:
 *  - todo lo creado es sintético y lleva `test-5f-<RUN>`; los datos reales
 *    (ADMIN real, Vicky, Felicitas, empleados, mascotas) solo se LEEN;
 *  - los ADMIN sintéticos de este archivo NUNCA reciben familia real;
 *  - `afterAll` borra solo lo creado (por id) y verifica 0 residuos y conteos
 *    globales idénticos a los iniciales.
 */

const RUN = `test-5f-${Date.now()}`;
const TZ = config.businessTimeZone;
/** Sufijo SOLO de letras para nombres visibles (la validación de 5F rechaza dígitos). */
const NAME_TAG = RUN.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x').replace(
  /-/g,
  ' ',
);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let otherAdmin: Actor;
let employee: Actor;
let employeeId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: Record<string, number>;
/** Ids de familiares sintéticos, compartidos entre bloques (se completan en orden). */
const ids: Record<string, string> = {};
let realFamily: { slug: string | null; ownerUserId: string | null; relation: string | null }[];

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
const statements: string[] = [];
let counting = false;

async function countStatements<T>(run: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  statements.length = 0;
  counting = true;
  try {
    const result = await run();
    return { result, sql: statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) };
  } finally {
    counting = false;
  }
}

async function globalCounts() {
  return {
    events: await prisma.event.count(),
    birthdays: await prisma.recurringBirthday.count(),
    userProfiles: await prisma.userProfile.count(),
    employeeProfiles: await prisma.employeeProfile.count(),
    children: await prisma.employeeChild.count(),
    animals: await prisma.animal.count(),
    employees: await prisma.employee.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    audits: await prisma.auditLog.count(),
    idempotency: await prisma.idempotencyRecord.count(),
  };
}

async function sessionFor(userId: string, role: 'ADMIN' | 'EMPLOYEE'): Promise<Actor> {
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });
  const token = await signAccessToken(
    { userId, sessionId: session.id, role },
    accessTokenSecret,
    3600,
  );
  return { userId, token };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, linked?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId: linked,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return sessionFor(user.id, role);
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const key = () => crypto.randomUUID().replace(/-/g, '');
const today = () => toLocalDate(new Date(), TZ);
/** Fecha de nacimiento cuyo cumpleaños cae dentro de `days` días (año fijo en el pasado). */
const birthIn = (days: number, year = 1990) =>
  formatLocalDate(addDays(today(), days)).replace(/^\d{4}/, String(year));
const events = (actor: Actor) => request(app).get('/api/v1/events?pastPageSize=5').set(as(actor));
type Item = {
  kind: string;
  origin: string;
  id: string;
  title: string;
  date: string;
  note: string;
  sourceRef: unknown;
};

beforeAll(async () => {
  baseline = await globalCounts();
  realFamily = await prisma.recurringBirthday.findMany({
    where: { slug: { in: ['vicky', 'felicitas'] } },
    select: { slug: true, ownerUserId: true, relation: true },
    orderBy: { slug: 'asc' },
  });
  app = createApp();
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Empleado ${RUN}`,
      role: 'Otro',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = emp.id;
  employeeIds.push(emp.id);
  admin = await createActor('ADMIN', 'admin');
  otherAdmin = await createActor('ADMIN', 'admin2');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);
  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) {
      const text =
        typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
      statements.push(text.trim().split(/\s+/)[0]?.toUpperCase() ?? '?');
    }
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  const memberIds = (
    await prisma.recurringBirthday.findMany({
      where: { ownerUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const eventIds = (
    await prisma.event.findMany({ where: { title: { contains: RUN } }, select: { id: true } })
  ).map((row) => row.id);
  const childIds = (
    await prisma.employeeChild.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...memberIds, ...eventIds, ...childIds, ...employeeIds, ...userIds] } },
      ],
    },
  });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.recurringBirthday.deleteMany({ where: { id: { in: memberIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.employeeChild.deleteMany({ where: { id: { in: childIds } } });
  await prisma.employeeProfile.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5f-' } } })).toBe(0);
  expect(await prisma.event.count({ where: { title: { contains: 'test-5f-' } } })).toBe(0);
  expect(
    await prisma.recurringBirthday.count({ where: { personLabel: { contains: 'test-5f-' } } }),
  ).toBe(0);
  // La familia real no se tocó.
  expect(
    await prisma.recurringBirthday.findMany({
      where: { slug: { in: ['vicky', 'felicitas'] } },
      select: { slug: true, ownerUserId: true, relation: true },
      orderBy: { slug: 'asc' },
    }),
  ).toEqual(realFamily);
}, 60_000);

describe('🔁 Vicky y Felicitas (datos reales, solo lectura)', () => {
  it('cada una existe una sola vez, asociada al ADMIN real como FAMILY y sin año inventado', async () => {
    for (const name of ['Vicky', 'Felicitas']) {
      const rows = await prisma.recurringBirthday.findMany({
        where: { personLabel: { equals: name, mode: 'insensitive' } },
        select: {
          slug: true,
          month: true,
          day: true,
          birthYear: true,
          relation: true,
          owner: { select: { role: true, username: true } },
        },
      });
      expect(rows, name).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        birthYear: null,
        relation: 'FAMILY',
        owner: { role: 'ADMIN' },
      });
      expect(rows[0]?.owner?.username.startsWith('test-')).toBe(false);
    }
    expect(realFamily.map((row) => [row.slug, row.relation])).toEqual([
      ['felicitas', 'FAMILY'],
      ['vicky', 'FAMILY'],
    ]);
  });

  it('aparecen UNA vez en Eventos, como familia del ADMIN; el EMPLOYEE no recibe enlace', async () => {
    const response = await events(employee);
    const upcoming = response.body.upcoming as Item[];
    for (const name of ['Vicky', 'Felicitas']) {
      const hits = upcoming.filter((item) => item.title === `Cumpleaños de ${name}`);
      expect(hits, name).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        kind: 'birthday',
        origin: 'USER_FAMILY',
        note: 'Familia',
        sourceRef: null,
      });
    }
    expect(upcoming.some((item) => /Benjam/.test(item.title))).toBe(false);
  });

  it('con más de un ADMIN activo el backfill se detiene sin escribir nada', async () => {
    const before = await prisma.recurringBirthday.findMany({ orderBy: { id: 'asc' } });
    await expect(backfillAdminFamily()).rejects.toThrow(/más de un ADMIN activo/);
    expect(await prisma.recurringBirthday.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });
});

describe('👤 perfil personal del ADMIN (sin Employee)', () => {
  it('GET /me/profile responde el perfil personal; guardar la fecha la hace aparecer UNA vez', async () => {
    const empty = await request(app).get('/api/v1/me/profile').set(as(admin));
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({
      kind: 'personal',
      profile: { displayName: null, birthDate: null },
    });

    const eventsBefore = await prisma.event.count();
    const birthDate = birthIn(2, 1980);
    const saved = await request(app)
      .put('/api/v1/me/profile')
      .set(as(admin))
      .send({ displayName: `Admin ${NAME_TAG}`, birthDate });
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toEqual({ displayName: `Admin ${NAME_TAG}`, birthDate });
    expect(await prisma.userProfile.count({ where: { userId: admin.userId } })).toBe(1);

    const mine = (await events(admin)).body.upcoming.filter(
      (item: Item) => item.title === `Cumpleaños de Admin ${NAME_TAG}`,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ origin: 'USER_PROFILE', sourceRef: { kind: 'MY_PROFILE' } });
    expect(await prisma.event.count()).toBe(eventsBefore);
  });

  it('el cuerpo es .strict(): no acepta userId ni campos laborales', async () => {
    for (const body of [
      { displayName: null, birthDate: null, userId: otherAdmin.userId },
      { displayName: null, birthDate: null, taxId: '20-1-1' },
    ]) {
      const response = await request(app).put('/api/v1/me/profile').set(as(admin)).send(body);
      expect(response.status).toBe(400);
    }
  });

  it('el ADMIN no aparece en empleados operativos, Tareas, Desempeño ni selectores', async () => {
    const name = `Admin ${NAME_TAG}`;
    for (const path of [
      '/api/v1/tasks/employees',
      '/api/v1/tasks',
      '/api/v1/employees',
      '/api/v1/employees/profiles',
      `/api/v1/performance/summary?from=${formatLocalDate(addDays(today(), -6))}&to=${formatLocalDate(today())}`,
      '/api/v1/dashboard',
    ]) {
      const response = await request(app).get(path).set(as(admin));
      expect(response.status, path).toBe(200);
      const body = JSON.stringify(response.body);
      expect(body, path).not.toContain(admin.userId);
      if (path !== '/api/v1/dashboard') expect(body, path).not.toContain(name);
    }
    expect(
      await prisma.employee.count({
        where: { displayName: { contains: RUN }, NOT: { id: employeeId } },
      }),
    ).toBe(0);
  });
});

describe('👨‍👩‍👧‍👦 Mi familia — CRUD por la sesión', () => {
  it('crea pareja, hijo y familiar genérico (sin año); el doble envío con la misma clave no duplica', async () => {
    const bodies = {
      partner: { name: `Pareja ${RUN}`, relation: 'PARTNER', birthDate: birthIn(3, 1982) },
      child: { name: `Hijo ${RUN}`, relation: 'CHILD', birthDate: birthIn(4, 2012) },
      family: {
        name: `Familiar ${RUN}`,
        relation: 'FAMILY',
        birthDate: birthIn(5).replace(/^\d{4}/, '-'),
      },
    };
    for (const [label, body] of Object.entries(bodies)) {
      const idem = key();
      const [first, replay] = await Promise.all([
        request(app)
          .post('/api/v1/me/family')
          .set(as(admin))
          .set('Idempotency-Key', idem)
          .send(body),
        request(app)
          .post('/api/v1/me/family')
          .set(as(admin))
          .set('Idempotency-Key', idem)
          .send(body),
      ]);
      expect(
        [first.status, replay.status].filter((s) => s === 201).length,
        label,
      ).toBeGreaterThanOrEqual(1);
      const ok = first.status === 201 ? first : replay;
      ids[label] = ok.body.member.id;
      expect(ok.body.member).toMatchObject({
        name: body.name,
        relation: body.relation,
        birthDate: body.birthDate,
        active: true,
        seeded: false,
      });
    }
    expect(await prisma.recurringBirthday.count({ where: { ownerUserId: admin.userId } })).toBe(3);
    const row = await prisma.recurringBirthday.findUniqueOrThrow({
      where: { id: ids.family as string },
    });
    expect(row).toMatchObject({ birthYear: null, slug: null, relation: 'FAMILY' });

    const duplicate = await request(app)
      .post('/api/v1/me/family')
      .set(as(admin))
      .send({ ...bodies.child, name: bodies.child.name.toUpperCase() });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('FAMILY_MEMBER_DUPLICATE');
    const homonym = await request(app)
      .post('/api/v1/me/family')
      .set(as(admin))
      .send({ ...bodies.child, birthDate: birthIn(6, 2014) });
    expect(homonym.status).toBe(201);
    ids.homonym = homonym.body.member.id;

    const upcoming = (await events(admin)).body.upcoming as Item[];
    for (const name of [`Pareja ${RUN}`, `Hijo ${RUN}`, `Familiar ${RUN}`]) {
      const hits = upcoming.filter((item) => item.title === `Cumpleaños de ${name}`);
      expect(hits.length, name).toBeGreaterThanOrEqual(1);
      expect(hits.every((item) => item.origin === 'USER_FAMILY')).toBe(true);
    }
    expect(upcoming.find((item) => item.title === `Cumpleaños de Pareja ${RUN}`)?.note).toBe(
      'Pareja',
    );
  });

  it('edita nombre, relación y fecha', async () => {
    const response = await request(app)
      .patch(`/api/v1/me/family/${ids.partner}`)
      .set(as(admin))
      .send({ name: `Pareja editada ${RUN}`, relation: 'OTHER', birthDate: birthIn(7, 1983) });
    expect(response.status).toBe(200);
    expect(response.body.member).toMatchObject({
      name: `Pareja editada ${RUN}`,
      relation: 'OTHER',
      birthDate: birthIn(7, 1983),
    });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: ids.partner, action: 'family.member_updated' },
    });
    expect(JSON.stringify(audit.newState)).not.toContain('1983');
  });

  it('desactivar lo saca de Eventos; reactivar lo devuelve', async () => {
    const title = `Cumpleaños de Hijo ${RUN}`;
    const off = await request(app)
      .patch(`/api/v1/me/family/${ids.child}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.member.active).toBe(false);
    let upcoming = (await events(admin)).body.upcoming as Item[];
    expect(upcoming.some((item) => item.id === `user_family:${ids.child}`)).toBe(false);
    const on = await request(app)
      .patch(`/api/v1/me/family/${ids.child}/status`)
      .set(as(admin))
      .send({ active: true });
    expect(on.status).toBe(200);
    upcoming = (await events(admin)).body.upcoming as Item[];
    expect(
      upcoming.filter((item) => item.id === `user_family:${ids.child}` && item.title === title),
    ).toHaveLength(1);
  });

  it('otra persona no ve ni modifica esta familia con ids forzados (404, fila intacta)', async () => {
    const target = ids.child as string;
    const before = await prisma.recurringBirthday.findUniqueOrThrow({ where: { id: target } });
    const other = await request(app).get('/api/v1/me/family').set(as(otherAdmin));
    expect(other.body.family).toEqual([]);
    for (const call of [
      request(app).patch(`/api/v1/me/family/${target}`).set(as(otherAdmin)).send({ name: 'x' }),
      request(app)
        .patch(`/api/v1/me/family/${target}/status`)
        .set(as(otherAdmin))
        .send({ active: false }),
      request(app).delete(`/api/v1/me/family/${target}`).set(as(otherAdmin)),
    ]) {
      const response = await call;
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('FAMILY_MEMBER_NOT_FOUND');
    }
    const forced = await request(app)
      .post('/api/v1/me/family')
      .set(as(otherAdmin))
      .send({ name: 'x', relation: 'CHILD', birthDate: '--01-01', ownerUserId: admin.userId });
    expect(forced.status).toBe(400);
    expect(await prisma.recurringBirthday.findUniqueOrThrow({ where: { id: target } })).toEqual(
      before,
    );
  });

  it('eliminar (creado por error): desaparece de Eventos, sin borrar Event; auditado; no afecta a los demás', async () => {
    const eventsBefore = await prisma.event.count();
    const [a, b] = await Promise.all([
      request(app).delete(`/api/v1/me/family/${ids.homonym}`).set(as(admin)),
      request(app).delete(`/api/v1/me/family/${ids.homonym}`).set(as(admin)),
    ]);
    expect([a.status, b.status].sort()).toEqual([204, 404]);
    expect(await prisma.recurringBirthday.count({ where: { id: ids.homonym } })).toBe(0);
    expect(await prisma.event.count()).toBe(eventsBefore);
    expect(
      await prisma.auditLog.count({
        where: { entityId: ids.homonym, action: 'family.member_deleted' },
      }),
    ).toBe(1);
    expect(await prisma.recurringBirthday.count({ where: { ownerUserId: admin.userId } })).toBe(3);
    const upcoming = (await events(admin)).body.upcoming as Item[];
    expect(upcoming.some((item) => item.id === `user_family:${ids.homonym}`)).toBe(false);
  });

  it('un familiar real del seed no se puede eliminar (se desactiva)', async () => {
    const real = await prisma.recurringBirthday.findUniqueOrThrow({
      where: { slug: 'vicky' },
      select: { id: true },
    });
    // Desde la sesión sintética ni siquiera existe (no es su familia): 404 y la fila sigue igual.
    const response = await request(app).delete(`/api/v1/me/family/${real.id}`).set(as(admin));
    expect(response.status).toBe(404);
    expect(await prisma.recurringBirthday.count({ where: { slug: 'vicky' } })).toBe(1);
  });
});

describe('👷 EMPLOYEE conserva su ficha de equipo', () => {
  it('Mi perfil sigue siendo la ficha con hijos; Mi familia no aplica; sin datos ajenos', async () => {
    const profile = await request(app).get('/api/v1/me/profile').set(as(employee));
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({
      kind: 'employee',
      employee: { id: employeeId },
      children: [],
    });
    const family = await request(app).get('/api/v1/me/family').set(as(employee));
    expect(family.status).toBe(409);
    expect(family.body.error.code).toBe('FAMILY_USES_EMPLOYEE_PROFILE');
    const body = JSON.stringify((await events(employee)).body);
    for (const leaked of [
      admin.userId,
      otherAdmin.userId,
      'ownerUserId',
      'birthYear',
      '"1980-',
      '"1982-',
    ]) {
      expect(body).not.toContain(leaked);
    }
  });
});

describe('🪪 nombre visible editable (sin tocar la identidad técnica)', () => {
  const profileBody = (displayName: string) => ({
    displayName,
    fullLegalName: null,
    birthDate: null,
    maritalStatus: null,
    phone: null,
    taxId: null,
    healthInsurance: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  });
  const identity = async () => ({
    user: await prisma.user.findUniqueOrThrow({
      where: { id: employee.userId },
      select: { id: true, username: true, role: true, status: true, employeeId: true },
    }),
    employee: await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { id: true, code: true, role: true, colorHex: true, active: true },
    }),
    sessions: await prisma.session.count({ where: { userId: employee.userId, revokedAt: null } }),
  });

  it('EMPLOYEE corrige su nombre: cambia Employee.displayName y nada más; la sesión sigue', async () => {
    const before = await identity();
    const saved = await request(app)
      .put('/api/v1/me/profile')
      .set(as(employee))
      .send(profileBody(`  Ñandú   O’Dwyer ${NAME_TAG} `));
    expect(saved.status).toBe(200);
    const name = `Ñandú O’Dwyer ${NAME_TAG}`;
    expect(saved.body.employee.displayName).toBe(name);
    expect(await identity()).toEqual(before);
    expect(await prisma.userProfile.count({ where: { userId: employee.userId } })).toBe(0);
    const me = await request(app).get('/api/v1/auth/me').set(as(employee));
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ displayName: name, employee: { displayName: name } });
    expect(JSON.stringify(me.body)).not.toContain(`${RUN}-emp`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: employeeId, action: 'employee.display_name_updated' },
    });
    expect(audit.newState).toMatchObject({ displayName: name, bySelf: true });
  });

  it('el body de /me/profile no acepta campos de identidad y valida el nombre en español', async () => {
    for (const extra of [
      { userId: admin.userId },
      { employeeId },
      { username: 'x' },
      { role: 'ADMIN' },
      { code: 'x' },
      { status: 'ACTIVE' },
    ]) {
      const response = await request(app)
        .put('/api/v1/me/profile')
        .set(as(employee))
        .send({ ...profileBody('Nombre Válido'), ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    for (const [name, message] of [
      ['', 'Ingresá el nombre.'],
      ['A', 'El nombre debe tener al menos 2 letras.'],
      ['Ana2', 'El nombre solo puede tener letras, espacios, apóstrofes, guiones y puntos.'],
    ] as const) {
      const response = await request(app)
        .put('/api/v1/me/profile')
        .set(as(employee))
        .send(profileBody(name));
      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe(message);
    }
    const admin400 = await request(app)
      .put('/api/v1/me/profile')
      .set(as(admin))
      .send({ displayName: 'Admin', birthDate: null, username: 'otro' });
    expect(admin400.status).toBe(400);
  });

  it('ADMIN cambia su nombre visible: /auth/me y el selector de ingreso lo muestran; username intacto', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: admin.userId },
      select: { username: true, role: true },
    });
    const name = `Admin Renombrado ${NAME_TAG}`;
    const saved = await request(app)
      .put('/api/v1/me/profile')
      .set(as(admin))
      .send({ displayName: name, birthDate: birthIn(2, 1980) });
    expect(saved.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(as(admin))).body.user.displayName).toBe(
      name,
    );
    const options = (await request(app).get('/api/v1/auth/login-options')).body.options as {
      id: string;
      displayName: string;
    }[];
    expect(options.find((option) => option.id === admin.userId)?.displayName).toBe(name);
    expect(options.find((option) => option.id === otherAdmin.userId)?.displayName).toBe(
      'Administrador',
    );
    expect(JSON.stringify(options)).not.toContain(`${RUN}-admin`);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: admin.userId },
        select: { username: true, role: true },
      }),
    ).toEqual(before);
    const own = ((await events(admin)).body.upcoming as Item[]).filter(
      (item) => item.origin === 'USER_PROFILE' && item.title === `Cumpleaños de ${name}`,
    );
    expect(own).toHaveLength(1);
  });

  it('ADMIN corrige el nombre de un empleado desde Datos del equipo (PATCH existente) sin tocar código ni sesiones', async () => {
    const before = await identity();
    const response = await request(app)
      .patch(`/api/v1/employees/${employeeId}`)
      .set(as(admin))
      .send({ displayName: 'Nombre  Corregido' });
    expect(response.status).toBe(200);
    expect(response.body.employee.displayName).toBe('Nombre Corregido');
    expect(await identity()).toEqual(before);
    expect((await request(app).get('/api/v1/auth/me').set(as(employee))).status).toBe(200);
    const forbidden = await request(app)
      .patch(`/api/v1/employees/${employeeId}`)
      .set(as(employee))
      .send({ displayName: 'Otro Nombre' });
    expect(forbidden.status).toBe(403);
  });
});

describe('🎂 cumpleaños manuales (Event tipo BIRTHDAY)', () => {
  let manualId = '';
  const date = () => formatLocalDate(addDays(today(), 20));

  it('ADMIN crea y edita; EMPLOYEE no puede', async () => {
    const body = {
      title: `Cumpleaños de Tía ${RUN}`,
      date: date(),
      type: 'BIRTHDAY',
      note: 'Cargado a mano',
    };
    expect((await request(app).post('/api/v1/events').set(as(employee)).send(body)).status).toBe(
      403,
    );
    const created = await request(app).post('/api/v1/events').set(as(admin)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.event).toMatchObject({ kind: 'event', origin: 'MANUAL', type: 'BIRTHDAY' });
    manualId = created.body.event.id;
    const edited = await request(app)
      .patch(`/api/v1/events/${manualId}`)
      .set(as(admin))
      .send({ note: 'Llevar torta' });
    expect(edited.status).toBe(200);
    expect(edited.body.event.note).toBe('Llevar torta');
    expect(
      (await request(app).patch(`/api/v1/events/${manualId}`).set(as(employee)).send({ note: 'x' }))
        .status,
    ).toBe(403);
  });

  it('duplicado manual (mayúsculas/espacios) → 409 en español', async () => {
    const response = await request(app)
      .post('/api/v1/events')
      .set(as(admin))
      .send({
        title: `  cumpleaños de  TÍA ${RUN.toUpperCase()} `,
        date: date(),
        type: 'BIRTHDAY',
      });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'EVENT_BIRTHDAY_DUPLICATE',
      message: 'Ya existe un cumpleaños con este nombre y fecha.',
    });
  });

  it('duplicado de un derivado activo → 409 con el mensaje pedido; otro día sí se permite', async () => {
    const birthday = ((await events(admin)).body.upcoming as Item[]).find(
      (item) => item.title === `Cumpleaños de Hijo ${RUN}`,
    ) as Item;
    const response = await request(app)
      .post('/api/v1/events')
      .set(as(admin))
      .send({ title: `Hijo ${RUN}`, date: birthday.date, type: 'BIRTHDAY' });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatchObject({
      code: 'EVENT_BIRTHDAY_DERIVED',
      message:
        'Este cumpleaños ya se genera automáticamente desde el perfil correspondiente. Editalo desde su perfil para evitar duplicados.',
    });
    const vicky = ((await events(admin)).body.upcoming as Item[]).find(
      (item) => item.title === 'Cumpleaños de Vicky',
    ) as Item;
    const real = await request(app)
      .post('/api/v1/events')
      .set(as(admin))
      .send({ title: 'Cumpleaños de Vicky', date: vicky.date, type: 'BIRTHDAY' });
    expect(real.status).toBe(409);
    expect(real.body.error.code).toBe('EVENT_BIRTHDAY_DERIVED');
  });

  it('los derivados no se editan ni anulan por los endpoints de Event', async () => {
    const memberId = ids.child as string;
    expect(
      (await request(app).patch(`/api/v1/events/${memberId}`).set(as(admin)).send({ note: 'x' }))
        .status,
    ).toBe(404);
    expect(
      (await request(app).post(`/api/v1/events/${memberId}/delete`).set(as(admin)).send({})).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .patch(`/api/v1/events/user_family:${memberId}`)
          .set(as(admin))
          .send({ note: 'x' })
      ).status,
    ).toBe(400);
    expect(await prisma.recurringBirthday.count({ where: { id: memberId, active: true } })).toBe(1);
  });

  it('anular: desaparece de Eventos e Inicio; la fila queda anulada y auditada; no toca perfiles ni familia', async () => {
    const familyBefore = await prisma.recurringBirthday.findMany({
      where: { ownerUserId: admin.userId },
      orderBy: { id: 'asc' },
    });
    const profileBefore = await prisma.userProfile.findUniqueOrThrow({
      where: { userId: admin.userId },
    });
    const voided = await request(app)
      .post(`/api/v1/events/${manualId}/delete`)
      .set(as(admin))
      .send({});
    expect(voided.status).toBe(200);
    const row = await prisma.event.findUniqueOrThrow({ where: { id: manualId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedByUserId).toBe(admin.userId);
    expect(
      await prisma.auditLog.count({
        where: {
          entityId: manualId,
          action: { in: ['event.created', 'event.updated', 'event.deleted'] },
        },
      }),
    ).toBe(3);
    expect(
      ((await events(admin)).body.upcoming as Item[]).some((item) => item.id === manualId),
    ).toBe(false);
    const dashboard = await request(app).get('/api/v1/dashboard').set(as(admin));
    expect((dashboard.body.upcomingEvents as Item[]).some((item) => item.id === manualId)).toBe(
      false,
    );
    expect(
      await prisma.recurringBirthday.findMany({
        where: { ownerUserId: admin.userId },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(familyBefore);
    expect(await prisma.userProfile.findUniqueOrThrow({ where: { userId: admin.userId } })).toEqual(
      profileBefore,
    );
  });
});

describe('⚡ rendimiento: sentencias fijas', () => {
  it('GET /events no crece con la cantidad de familiares (sin N+1)', async () => {
    const first = await countStatements(() => events(admin));
    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post('/api/v1/me/family')
        .set(as(admin))
        .send({
          name: `Extra ${index} ${RUN}`,
          relation: 'OTHER',
          birthDate: `--0${index + 1}-15`,
        });
    }
    const second = await countStatements(() => events(admin));
    expect(second.result.status).toBe(200);
    expect(second.sql.length).toBe(first.sql.length);
    expect(second.sql.length).toBeLessThanOrEqual(11); // auth + 3 de eventos + 5 fuentes (+ relaciones)
  });
});
