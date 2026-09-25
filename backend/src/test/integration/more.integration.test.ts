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
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';
import { setWeatherFetcherForTests } from '../../more/weatherService';

/**
 * ☰ Más (Etapa 5X) contra Neon real (`demo`) por HTTP real. Reglas:
 *  - todo lo creado es sintético y lleva `test-5x-<RUN>`; los datos reales
 *    (2 novedades, 2 eventos, cumpleaños de familia, empleados) solo se leen;
 *  - el almacenamiento de fotos es EN MEMORIA (nunca el bucket real) y Open-Meteo
 *    se reemplaza por una respuesta fija (sin red externa);
 *  - `afterAll` borra solo lo creado (por id) y verifica 0 residuos y conteos
 *    globales idénticos a los iniciales.
 */

const RUN = `test-5x-${Date.now()}`;
const TZ = config.businessTimeZone;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(RUN)]);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
let employeeId = '';
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: Record<string, number>;

const objects = new Map<string, Buffer>();
const memoryStorage: ObjectStorageClient = {
  bucket: 'memoria-test',
  async putObject(key, body) {
    objects.set(key, body);
    return { etag: '"memoria"' };
  },
  async getObject(key) {
    const body = objects.get(key);
    return body ? { body, contentType: null, etag: null } : null;
  },
  async deleteObject(key) {
    objects.delete(key);
  },
};

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
    news: await prisma.newsReport.count(),
    events: await prisma.event.count(),
    birthdays: await prisma.recurringBirthday.count(),
    files: await prisma.fileAsset.count(),
    profiles: await prisma.employeeProfile.count(),
    children: await prisma.employeeChild.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    audits: await prisma.auditLog.count(),
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
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
const localToday = () => toLocalDate(new Date(), TZ);

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Sintético ${RUN}`,
      role: 'Otro',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = emp.id;
  employeeIds.push(emp.id);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', employeeId);
  setObjectStorageForTests(memoryStorage);
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
  setObjectStorageForTests(undefined);
  setWeatherFetcherForTests(null);
  const created = await prisma.employee.findMany({
    where: { code: { startsWith: RUN } },
    select: { id: true, user: { select: { id: true } } },
  });
  for (const row of created) {
    if (!employeeIds.includes(row.id)) employeeIds.push(row.id);
    if (row.user && !userIds.includes(row.user.id)) userIds.push(row.user.id);
  }
  const newsIds = (
    await prisma.newsReport.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const eventIds = (
    await prisma.event.findMany({ where: { title: { startsWith: RUN } }, select: { id: true } })
  ).map((row) => row.id);
  const fileIds = (
    await prisma.fileAsset.findMany({ where: { title: { startsWith: RUN } }, select: { id: true } })
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
        { entityId: { in: [...newsIds, ...eventIds, ...fileIds, ...childIds, ...employeeIds] } },
      ],
    },
  });
  await prisma.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
  await prisma.newsReport.deleteMany({ where: { id: { in: newsIds } } });
  await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.employeeChild.deleteMany({ where: { id: { in: childIds } } });
  await prisma.employeeProfile.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-5x-' } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5x-' } } })).toBe(0);
  expect(await prisma.event.count({ where: { title: { startsWith: 'test-5x-' } } })).toBe(0);
  expect(await prisma.fileAsset.count({ where: { title: { startsWith: 'test-5x-' } } })).toBe(0);
  expect(objects.size).toBe(0);
}, 60_000);

describe('📝 Novedades', () => {
  it('EMPLOYEE queda como autor; un texto repetido se permite; replay con la misma clave', async () => {
    const body = { text: `${RUN} Se cortó la luz` };
    const idem = key();
    const first = await request(app)
      .post('/api/v1/news')
      .set(as(employee))
      .set('Idempotency-Key', idem)
      .send(body);
    const replay = await request(app)
      .post('/api/v1/news')
      .set(as(employee))
      .set('Idempotency-Key', idem)
      .send(body);
    const again = await request(app).post('/api/v1/news').set(as(employee)).send(body);
    expect([first.status, replay.status, again.status]).toEqual([201, 201, 201]);
    expect(replay.body.news.id).toBe(first.body.news.id);
    expect(again.body.news.id).not.toBe(first.body.news.id);
    expect(first.body.news.employee.id).toBe(employeeId);
    const rows = await prisma.newsReport.findMany({ where: { employeeId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.recordedByUserId === employee.userId)).toBe(true);
  });

  it('EMPLOYEE no reporta por otra persona; ADMIN sí (actor real separado)', async () => {
    const forbidden = await request(app)
      .post('/api/v1/news')
      .set(as(employee))
      .send({ text: `${RUN} x`, employeeId: crypto.randomUUID() });
    expect(forbidden.status).toBe(403);
    const byAdmin = await request(app)
      .post('/api/v1/news')
      .set(as(admin))
      .send({ text: `${RUN} desde admin`, employeeId });
    expect(byAdmin.status).toBe(201);
    const row = await prisma.newsReport.findUniqueOrThrow({ where: { id: byAdmin.body.news.id } });
    expect(row).toMatchObject({ employeeId, recordedByUserId: admin.userId });
  });

  it('historial: más reciente primero, paginado, con sentencias fijas', async () => {
    const { result, sql } = await countStatements(() =>
      request(app).get('/api/v1/news?pageSize=2').set(as(employee)),
    );
    expect(result.status).toBe(200);
    expect(result.body.news).toHaveLength(2);
    expect(result.body.news[0].text).toBe(`${RUN} desde admin`);
    expect(result.body.total).toBeGreaterThanOrEqual(5);
    expect(sql.length).toBeLessThanOrEqual(4); // auth + conteo + página + empleados
  });
});

describe('📅 Eventos y 🎂 cumpleaños derivados', () => {
  const future = () => formatLocalDate(addDays(localToday(), 10));
  const past = () => formatLocalDate(addDays(localToday(), -3));

  it('solo ADMIN crea; duplicado vigente = 409; eliminar anula y permite volver a cargarlo', async () => {
    const body = { title: `${RUN} Visita`, date: future(), type: 'VISIT', note: 'Preparar asado' };
    expect((await request(app).post('/api/v1/events').set(as(employee)).send(body)).status).toBe(
      403,
    );
    const created = await request(app).post('/api/v1/events').set(as(admin)).send(body);
    expect(created.status).toBe(201);
    expect(created.body.event.daysUntil).toBe(10);
    const duplicate = await request(app).post('/api/v1/events').set(as(admin)).send(body);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('EVENT_DUPLICATE');

    const id = created.body.event.id as string;
    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/events/${id}/delete`).set(as(admin)).send({}),
      request(app).post(`/api/v1/events/${id}/delete`).set(as(admin)).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const row = await prisma.event.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedByUserId).toBe(admin.userId);
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'event.deleted' } })).toBe(
      1,
    );

    const again = await request(app).post('/api/v1/events').set(as(admin)).send(body);
    expect(again.status).toBe(201);
  });

  it('Próximos incluye cumpleaños calculados (familia, equipo, hijos); Pasados paginados; leer no crea filas', async () => {
    await request(app)
      .post('/api/v1/events')
      .set(as(admin))
      .send({ title: `${RUN} Mantenimiento viejo`, date: past(), type: 'MAINTENANCE' });
    const birth = formatLocalDate(addDays(localToday(), 1)).replace(/^\d{4}/, '1990');
    const profile = await request(app).put('/api/v1/me/profile').set(as(employee)).send({
      fullLegalName: null,
      birthDate: birth,
      maritalStatus: null,
      phone: null,
      taxId: null,
      healthInsurance: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
    expect(profile.status).toBe(200);
    const child = await request(app)
      .post('/api/v1/me/children')
      .set(as(employee))
      .send({ name: `${RUN} Hijo`, birthDate: '2020-01-15' });
    expect(child.status).toBe(201);

    const eventsBefore = await prisma.event.count();
    const { result, sql } = await countStatements(() =>
      request(app).get('/api/v1/events?pastPageSize=5').set(as(employee)),
    );
    expect(result.status).toBe(200);
    expect(await prisma.event.count()).toBe(eventsBefore);
    const upcoming = result.body.upcoming as {
      kind: string;
      title: string;
      daysUntil: number;
      note: string;
    }[];
    expect(
      upcoming.some((item) => item.title === 'Cumpleaños de Vicky' && item.note === 'Familia'),
    ).toBe(true);
    expect(upcoming.some((item) => item.title === 'Cumpleaños de Felicitas')).toBe(true);
    const mine = upcoming.find((item) => item.title === `Cumpleaños de Sintético ${RUN}`);
    expect(mine).toMatchObject({ kind: 'birthday', daysUntil: 1, note: 'Equipo' });
    expect(upcoming.some((item) => item.note === `Hijo/a de Sintético ${RUN}`)).toBe(true);
    expect(upcoming.every((item) => item.daysUntil >= 0)).toBe(true);
    expect(upcoming.map((item) => item.daysUntil)).toEqual(
      [...upcoming.map((item) => item.daysUntil)].sort((x, y) => x - y),
    );
    expect(upcoming.some((item) => /Benjam/.test(item.title))).toBe(false);
    const pastItems = result.body.past.items as { title: string; daysUntil: number }[];
    expect(pastItems.find((item) => item.title === `${RUN} Mantenimiento viejo`)?.daysUntil).toBe(
      -3,
    );
    expect(sql.length).toBeLessThanOrEqual(10);

    const visits = await request(app).get('/api/v1/events?type=VISIT').set(as(employee));
    expect(visits.body.upcoming.every((item: { type: string }) => item.type === 'VISIT')).toBe(
      true,
    );
  });

  it('la tarjeta de Más cuenta novedades, eventos próximos (cumpleaños incluidos) y fotos', async () => {
    const summary = await request(app).get('/api/v1/more/summary').set(as(employee));
    expect(summary.status).toBe(200);
    expect(summary.body.news.today).toBeGreaterThanOrEqual(3);
    expect(summary.body.events.upcoming).toBeGreaterThanOrEqual(5);
    expect(summary.body.photos).toEqual({ total: expect.any(Number) });
  });
});

describe('📸 Fotos (almacenamiento en memoria contra Postgres real)', () => {
  let photoId = '';
  const upload = (actor: Actor, idem?: string, title = `${RUN} Jardín`) => {
    const call = request(app)
      .post(
        `/api/v1/photos?category=MEMORY&title=${encodeURIComponent(title)}&employeeId=${employeeId}`,
      )
      .set(as(actor))
      .set('Content-Type', 'image/jpeg')
      .set('X-File-Name', 'jardin.jpg');
    return (idem ? call.set('Idempotency-Key', idem) : call).send(JPEG);
  };

  it('EMPLOYEE sube; el reintento con la misma clave no duplica ni vuelve a subir', async () => {
    const idem = key();
    const first = await upload(employee, idem);
    const replay = await upload(employee, idem);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.body.photo.id).toBe(first.body.photo.id);
    photoId = first.body.photo.id;
    const rows = await prisma.fileAsset.findMany({ where: { title: `${RUN} Jardín` } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'AVAILABLE',
      category: 'MEMORY',
      taggedEmployeeId: employeeId,
    });
    expect(rows[0]?.objectKey).toMatch(/^memories\/\d{4}\/[0-9a-f-]{36}\.jpg$/);
    expect(first.body.photo).not.toHaveProperty('objectKey');
    expect(first.body.photo).not.toHaveProperty('bucket');
    expect(objects.size).toBe(1);
  });

  it('galería filtrable, sin exponer datos del bucket; imagen con ETag y 304', async () => {
    const { result, sql } = await countStatements(() =>
      request(app).get('/api/v1/photos?category=MEMORY').set(as(employee)),
    );
    expect(result.status).toBe(200);
    expect(result.body.photos.some((photo: { id: string }) => photo.id === photoId)).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/memoria-test|objectKey|memories\//);
    expect(sql.length).toBeLessThanOrEqual(4);
    const tasks = await request(app).get('/api/v1/photos?category=TASK_EVIDENCE').set(as(employee));
    expect(tasks.body.photos.some((photo: { id: string }) => photo.id === photoId)).toBe(false);

    const image = await request(app).get(`/api/v1/photos/${photoId}/content`).set(as(employee));
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    const etag = image.headers.etag as string;
    const cached = await request(app)
      .get(`/api/v1/photos/${photoId}/content`)
      .set(as(employee))
      .set('If-None-Match', etag);
    expect(cached.status).toBe(304);
  });

  it('eliminar: EMPLOYEE 403; ADMIN baja lógica + borrado físico; ya no se sirve', async () => {
    expect(
      (await request(app).post(`/api/v1/photos/${photoId}/delete`).set(as(employee)).send({}))
        .status,
    ).toBe(403);
    const deleted = await request(app)
      .post(`/api/v1/photos/${photoId}/delete`)
      .set(as(admin))
      .send({});
    expect(deleted.status).toBe(200);
    expect((await prisma.fileAsset.findUniqueOrThrow({ where: { id: photoId } })).status).toBe(
      'DELETED',
    );
    expect(objects.size).toBe(0);
    expect(
      (await request(app).get(`/api/v1/photos/${photoId}/content`).set(as(employee))).status,
    ).toBe(404);
  });
});

describe('⚙️ Personas y 👤 Mi perfil', () => {
  it('ADMIN da de alta una persona (cuenta pendiente, sin PIN) y EMPLOYEE no ve Configuración', async () => {
    expect((await request(app).get('/api/v1/employees').set(as(employee))).status).toBe(403);
    const created = await request(app)
      .post('/api/v1/employees')
      .set(as(admin))
      .send({ displayName: `${RUN}-p`, role: 'Parque', colorHex: '#2C5364' });
    expect(created.status).toBe(201);
    expect(created.body.employee).toMatchObject({
      role: 'Parque',
      colorHex: '#2c5364',
      active: true,
      account: { status: 'PENDING_ACTIVATION', hasPin: false },
    });
    const list = await request(app).get('/api/v1/employees').set(as(admin));
    expect(
      list.body.employees.some((row: { id: string }) => row.id === created.body.employee.id),
    ).toBe(true);
    expect(JSON.stringify(list.body)).not.toMatch(/pinHash|pin_hash/);
  });

  it('dar de baja revoca las sesiones, saca a la persona del selector y bloquea sus requests', async () => {
    const options = async () =>
      (await request(app).get('/api/v1/auth/login-options')).body.options as { id: string }[];
    expect((await options()).some((option) => option.id === employee.userId)).toBe(true);
    const off = await request(app)
      .patch(`/api/v1/employees/${employeeId}/status`)
      .set(as(admin))
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(
      await prisma.session.count({ where: { userId: employee.userId, revokedAt: null } }),
    ).toBe(0);
    expect((await options()).some((option) => option.id === employee.userId)).toBe(false);
    expect((await request(app).get('/api/v1/news').set(as(employee))).status).toBe(401);

    const on = await request(app)
      .patch(`/api/v1/employees/${employeeId}/status`)
      .set(as(admin))
      .send({ active: true });
    expect(on.status).toBe(200);
    employee = await sessionFor(employee.userId, 'EMPLOYEE');
  });

  it('Datos del equipo (ADMIN): ficha e hijos del perfil cargado por la propia persona', async () => {
    const team = await request(app)
      .get('/api/v1/employees/profiles?filter=complete')
      .set(as(admin));
    expect(team.status).toBe(200);
    const member = team.body.team.find((row: { id: string }) => row.id === employeeId);
    expect(member).toMatchObject({ complete: true });
    expect(member.children[0]).toMatchObject({
      name: `${RUN} Hijo`,
      age: { years: expect.any(Number) },
    });
    const incomplete = await request(app)
      .get('/api/v1/employees/profiles?filter=incomplete')
      .set(as(admin));
    expect(incomplete.body.team.some((row: { id: string }) => row.id === employeeId)).toBe(false);
  });

  it('Mi perfil: un hijo se elimina solo del propio perfil', async () => {
    const mine = await request(app).get('/api/v1/me/profile').set(as(employee));
    expect(mine.status).toBe(200);
    const childId = mine.body.children[0].id as string;
    expect(
      (await request(app).post(`/api/v1/me/children/${childId}/remove`).set(as(admin)).send({}))
        .status,
    ).toBe(409);
    const removed = await request(app)
      .post(`/api/v1/me/children/${childId}/remove`)
      .set(as(employee))
      .send({});
    expect(removed.status).toBe(200);
    expect(await prisma.employeeChild.count({ where: { id: childId } })).toBe(0);
  });
});

describe('🌤️ Clima', () => {
  it('usa la ubicación real sembrada y responde el informe (Open-Meteo reemplazado)', async () => {
    const urls: string[] = [];
    setWeatherFetcherForTests(async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          current: {
            temperature_2m: 18,
            relative_humidity_2m: 70,
            apparent_temperature: 17,
            precipitation: 0,
            weather_code: 3,
            wind_speed_10m: 12,
          },
          daily: {
            time: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'],
            weather_code: [3, 3, 0, 0, 1],
            temperature_2m_max: [20, 21, 22, 23, 24],
            temperature_2m_min: [10, 10, 11, 12, 13],
            precipitation_sum: [0, 0, 0, 0, 0],
            precipitation_probability_max: [5, 5, 5, 5, 5],
          },
        }),
      );
    });
    const response = await request(app).get('/api/v1/weather').set(as(employee));
    expect(response.status).toBe(200);
    expect(response.body.location.label).toBe('Villa Elisa, Entre Ríos');
    expect(response.body.recommendations[0].text).toBe('Regar hoy — no se esperan lluvias');
    expect(urls[0]).toMatch(/latitude=-32\.15/);
  });
});
