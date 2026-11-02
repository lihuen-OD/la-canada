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
import { setDriveBackupConfigForTests } from '../../driveBackup/config';
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
/** Sufijo SOLO de letras para nombres visibles (la validación de 5F rechaza dígitos). */
const NAME_TAG = RUN.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x').replace(
  /-/g,
  ' ',
);
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
    newsReplies: await prisma.newsReply.count(),
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
      displayName: `Sintético ${NAME_TAG}`,
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
  // Las fotos viven en memoria: nunca se encolan copias en Drive (eso lo
  // prueba driveBackup.integration), aunque el `.env` local la tenga activa.
  setDriveBackupConfigForTests(null);
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
  setDriveBackupConfigForTests(undefined);
  setWeatherFetcherForTests(null);
  const created = await prisma.employee.findMany({
    where: { OR: [{ code: { startsWith: RUN } }, { id: { in: employeeIds } }] },
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
  const newsReplyIds = (
    await prisma.newsReply.findMany({
      where: { newsReportId: { in: newsIds } },
      select: { id: true },
    })
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
        {
          entityId: {
            in: [...newsIds, ...newsReplyIds, ...eventIds, ...fileIds, ...childIds, ...employeeIds],
          },
        },
      ],
    },
  });
  // Defensa: un trabajo de copia de estas fotos (FK RESTRICT) impediría borrarlas.
  await prisma.driveBackupJob.deleteMany({ where: { fileAssetId: { in: fileIds } } });
  await prisma.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
  await prisma.photoFolder.deleteMany({ where: { createdByUserId: { in: userIds } } });
  await prisma.newsReply.deleteMany({ where: { id: { in: newsReplyIds } } });
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
    expect(sql.length).toBeLessThanOrEqual(5); // auth + conteo + página + aggregate de respuestas + nombres
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
    const profile = await request(app)
      .put('/api/v1/me/profile')
      .set(as(employee))
      .send({
        displayName: `Sintético ${NAME_TAG}`,
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
    const mine = upcoming.find((item) => item.title === `Cumpleaños de Sintético ${NAME_TAG}`);
    expect(mine).toMatchObject({ kind: 'birthday', daysUntil: 1, note: 'Equipo' });
    expect(upcoming.some((item) => item.note === `Hijo/a de Sintético ${NAME_TAG}`)).toBe(true);
    expect(upcoming.every((item) => item.daysUntil >= 0)).toBe(true);
    expect(upcoming.map((item) => item.daysUntil)).toEqual(
      [...upcoming.map((item) => item.daysUntil)].sort((x, y) => x - y),
    );
    expect(upcoming.some((item) => /Benjam/.test(item.title))).toBe(false);
    const pastItems = result.body.past.items as { title: string; daysUntil: number }[];
    expect(pastItems.find((item) => item.title === `${RUN} Mantenimiento viejo`)?.daysUntil).toBe(
      -3,
    );
    // auth + 3 de eventos + 5 fuentes de cumpleaños (Etapa 5F: +1, perfil personal) + relaciones.
    expect(sql.length).toBeLessThanOrEqual(11);

    const visits = await request(app).get('/api/v1/events?type=VISIT').set(as(employee));
    expect(visits.body.upcoming.every((item: { type: string }) => item.type === 'VISIT')).toBe(
      true,
    );
  });

  it('la tarjeta de Más cuenta novedades, eventos próximos (cumpleaños incluidos), fotos y planos', async () => {
    const summary = await request(app).get('/api/v1/more/summary').set(as(employee));
    expect(summary.status).toBe(200);
    expect(summary.body.news.today).toBeGreaterThanOrEqual(3);
    expect(summary.body.events.upcoming).toBeGreaterThanOrEqual(5);
    expect(summary.body.photos).toEqual({ total: expect.any(Number) });
    expect(summary.body.garden).toEqual({ versions: expect.any(Number) });
  });
});

describe('📸 Fotos (almacenamiento en memoria contra Postgres real)', () => {
  let photoId = '';
  let folderId = '';
  // Toda foto nueva necesita una carpeta (sintética, se borra en afterAll).
  beforeAll(async () => {
    const folder = await request(app)
      .post('/api/v1/photos/folders')
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ name: `${RUN} Carpeta` });
    expect(folder.status).toBe(201);
    folderId = folder.body.folder.id;
  });
  const upload = (actor: Actor, idem?: string, title = `${RUN} Jardín`) => {
    const call = request(app)
      .post(
        `/api/v1/photos?category=MEMORY&title=${encodeURIComponent(title)}&employeeId=${employeeId}&folderId=${folderId}`,
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
      .send({ displayName: `Persona ${NAME_TAG}`, role: 'Parque', colorHex: '#2C5364' });
    expect(created.status).toBe(201);
    // El código sale del nombre: se registra el id para que la limpieza lo encuentre.
    employeeIds.push(created.body.employee.id);
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

describe('💬 Conversaciones por novedad', () => {
  async function createSyntheticNews(text: string) {
    const news = await prisma.newsReport.create({
      data: {
        employeeId,
        text: `${RUN} ${text}`,
        recordedByUserId: employee.userId,
        createdAt: new Date('2020-01-02T03:04:05.000Z'),
      },
      select: { id: true, text: true, createdAt: true },
    });
    return news;
  }

  it('ADMIN sin Employee y EMPLOYEE responden con autor de sesión; el hilo no altera la novedad', async () => {
    const news = await createSyntheticNews('La bomba de riego hace ruido');
    const anotherNews = await createSyntheticNews('Otro aviso independiente');
    const first = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(admin))
      .set('Idempotency-Key', key())
      .send({ text: '  Mañana viene el técnico  ' });
    expect(first.status).toBe(201);
    expect(first.body.reply).toMatchObject({
      text: 'Mañana viene el técnico',
      author: { displayName: 'Administrador' },
      quote: null,
    });

    const quoted = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ text: 'Perfecto, la dejo apagada', quotedReplyId: first.body.reply.id });
    expect(quoted.status).toBe(201);
    expect(quoted.body.reply).toMatchObject({
      author: { displayName: `Sintético ${NAME_TAG}` },
      quote: {
        id: first.body.reply.id,
        text: 'Mañana viene el técnico',
        author: { displayName: 'Administrador' },
      },
    });

    const crossThreadQuote = await request(app)
      .post(`/api/v1/news/${anotherNews.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ text: 'No corresponde', quotedReplyId: first.body.reply.id });
    expect(crossThreadQuote.status).toBe(400);
    expect(crossThreadQuote.body.error.code).toBe('NEWS_REPLY_QUOTE_INVALID');

    const spoof = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ text: 'No se acepta el autor del cliente', authorUserId: admin.userId });
    expect(spoof.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { entityId: quoted.body.reply.id } })).toBe(1);
    expect(await prisma.newsReport.findUniqueOrThrow({ where: { id: news.id } })).toMatchObject({
      text: news.text,
      createdAt: news.createdAt,
    });
    expect(
      (await request(app).get(`/api/v1/news/${anotherNews.id}/replies`).set(as(employee))).body
        .replies,
    ).toHaveLength(0);
  });

  it('reintentos reproducen la respuesta; otra carga con la misma clave da conflicto', async () => {
    const news = await createSyntheticNews('Idempotencia sintética');
    const idem = key();
    const body = { text: `${RUN} envío único\ncon salto` };
    const first = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', idem)
      .send(body);
    const replay = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', idem)
      .send(body);
    const conflict = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', idem)
      .send({ text: 'otro contenido' });
    const differentAttempt = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send(body);
    const missingKey = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .send({ text: 'sin clave' });

    expect([
      first.status,
      replay.status,
      conflict.status,
      differentAttempt.status,
      missingKey.status,
    ]).toEqual([201, 201, 409, 201, 400]);
    expect(replay.body.reply.id).toBe(first.body.reply.id);
    expect(first.body.reply.text).toBe(`${RUN} envío único\ncon salto`);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(differentAttempt.body.reply.id).not.toBe(first.body.reply.id);
    expect(await prisma.newsReply.count({ where: { newsReportId: news.id } })).toBe(2);
  });

  it('valida texto y acepta dos respuestas simultáneas legítimas', async () => {
    const news = await createSyntheticNews('Validación y concurrencia');
    const empty = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ text: ' \n\t ' });
    const tooLong = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(employee))
      .set('Idempotency-Key', key())
      .send({ text: 'x'.repeat(1001) });
    const concurrent = await Promise.all(
      [admin, employee].map((actor, index) =>
        request(app)
          .post(`/api/v1/news/${news.id}/replies`)
          .set(as(actor))
          .set('Idempotency-Key', key())
          .send({ text: `${RUN} concurrent-${index}` }),
      ),
    );
    expect([empty.status, tooLong.status]).toEqual([400, 400]);
    expect(concurrent.map((response) => response.status)).toEqual([201, 201]);
    expect(await prisma.newsReply.count({ where: { newsReportId: news.id } })).toBe(2);
  });

  it('pagina más de 40 respuestas con cursor estable y no devuelve cuerpos en el historial', async () => {
    const news = await createSyntheticNews('Paginación sintética');
    const ids = Array.from({ length: 41 }, () => crypto.randomUUID());
    const sharedTimestamp = new Date('2026-10-29T12:00:00.000Z');
    await prisma.newsReply.createMany({
      data: ids.map((id, index) => ({
        id,
        newsReportId: news.id,
        authorUserId: admin.userId,
        text: `${RUN} página-${index}`,
        createdAt: sharedTimestamp,
      })),
    });

    const first = await request(app).get(`/api/v1/news/${news.id}/replies`).set(as(employee));
    const second = await request(app)
      .get(`/api/v1/news/${news.id}/replies`)
      .query({
        beforeCreatedAt: first.body.nextCursor.createdAt,
        beforeId: first.body.nextCursor.id,
      })
      .set(as(employee));
    const third = await request(app)
      .get(`/api/v1/news/${news.id}/replies`)
      .query({
        beforeCreatedAt: second.body.nextCursor.createdAt,
        beforeId: second.body.nextCursor.id,
      })
      .set(as(employee));
    expect(first.status).toBe(200);
    expect(first.body.replies).toHaveLength(20);
    expect(second.body.replies).toHaveLength(20);
    expect(third.body.replies).toHaveLength(1);
    expect([first.body.hasOlder, second.body.hasOlder, third.body.hasOlder]).toEqual([
      true,
      true,
      false,
    ]);
    const pages = [first, second, third].flatMap((page) => page.body.replies);
    expect(new Set(pages.map((reply) => reply.id)).size).toBe(41);
    expect(pages.map((reply) => reply.id).sort((a, b) => a.localeCompare(b))).toEqual(
      [...ids].sort((a, b) => a.localeCompare(b)),
    );

    const history = await request(app).get('/api/v1/news?pageSize=50').set(as(employee));
    const listed = history.body.news.find((item: { id: string }) => item.id === news.id);
    expect(listed).toMatchObject({
      replyCount: 41,
      lastReply: {
        author: { displayName: 'Administrador' },
        createdAt: sharedTimestamp.toISOString(),
      },
    });
    expect(listed).not.toHaveProperty('replies');
    expect(JSON.stringify(listed)).not.toContain(`${RUN} página-`);
  });
});

describe('✏️ Edición y eliminación de mensajes de Novedades', () => {
  let other: Actor;
  let otherEmployeeId = '';

  beforeAll(async () => {
    const emp = await prisma.employee.create({
      data: {
        code: `${RUN}-emp-other`,
        displayName: `Otra sintética ${NAME_TAG}`,
        role: 'Otro',
        colorHex: '#8a6d3b',
      },
      select: { id: true },
    });
    otherEmployeeId = emp.id;
    employeeIds.push(emp.id);
    other = await createActor('EMPLOYEE', 'emp-other', otherEmployeeId);
  });

  /** Novedad sintética con fecha vieja (no aparece arriba del historial real de `demo`). */
  async function syntheticNews(text: string, recordedByUserId: string | null) {
    return prisma.newsReport.create({
      data: {
        employeeId,
        text: `${RUN} ${text}`,
        recordedByUserId,
        createdAt: new Date('2020-02-03T04:05:06.000Z'),
      },
      select: { id: true, text: true, createdAt: true, employeeId: true },
    });
  }

  async function reply(newsId: string, actor: Actor, text: string, quotedReplyId?: string) {
    const response = await request(app)
      .post(`/api/v1/news/${newsId}/replies`)
      .set(as(actor))
      .set('Idempotency-Key', key())
      .send({ text: `${RUN} ${text}`, ...(quotedReplyId ? { quotedReplyId } : {}) });
    expect(response.status).toBe(201);
    return response.body.reply as { id: string; text: string; createdAt: string; version: number };
  }

  const edit = (actor: Actor, path: string, body: object) =>
    request(app).patch(`/api/v1/news/${path}`).set(as(actor)).send(body);
  const remove = (actor: Actor, path: string, version: number) =>
    request(app).post(`/api/v1/news/${path}/delete`).set(as(actor)).send({ version });
  const audits = (entityId: string, action: string) =>
    prisma.auditLog.findMany({ where: { entityId, action }, orderBy: { createdAt: 'asc' } });

  it('EMPLOYEE autor edita novedad y respuesta: misma fila, autor, fecha y cantidad; auditoría; sin cambios no escribe', async () => {
    const news = await syntheticNews('Aviso para editar', employee.userId);
    const original = await reply(news.id, employee, 'línea uno');
    const repliesBefore = await prisma.newsReply.count({ where: { newsReportId: news.id } });
    const newsBefore = await prisma.newsReport.count({ where: { employeeId } });

    const editedNews = await edit(employee, news.id, {
      text: `  ${RUN}   Aviso   corregido `,
      version: 1,
    });
    expect(editedNews.status).toBe(200);
    expect(editedNews.body.news).toMatchObject({
      id: news.id,
      text: `${RUN} Aviso corregido`,
      createdAt: news.createdAt.toISOString(),
      employee: { id: employeeId },
      version: 2,
      deleted: false,
      editedAt: expect.any(String),
      permissions: { canEdit: true, canDelete: true, canReply: true },
    });
    const editedReply = await edit(employee, `${news.id}/replies/${original.id}`, {
      text: `${RUN} línea uno\nlínea dos`,
      version: 1,
    });
    expect(editedReply.status).toBe(200);
    expect(editedReply.body.reply).toMatchObject({
      id: original.id,
      text: `${RUN} línea uno\nlínea dos`,
      createdAt: original.createdAt,
      author: { displayName: `Sintético ${NAME_TAG}` },
      version: 2,
      editedAt: expect.any(String),
    });

    const newsRow = await prisma.newsReport.findUniqueOrThrow({ where: { id: news.id } });
    expect(newsRow).toMatchObject({
      recordedByUserId: employee.userId,
      employeeId,
      createdAt: news.createdAt,
      deletedAt: null,
    });
    const replyRow = await prisma.newsReply.findUniqueOrThrow({ where: { id: original.id } });
    expect(replyRow).toMatchObject({ authorUserId: employee.userId, newsReportId: news.id });
    expect(await prisma.newsReply.count({ where: { newsReportId: news.id } })).toBe(repliesBefore);
    expect(await prisma.newsReport.count({ where: { employeeId } })).toBe(newsBefore);

    const [newsAudit] = await audits(news.id, 'news.updated');
    expect(newsAudit).toMatchObject({
      actorUserId: employee.userId,
      previousState: { text: news.text, version: 1 },
      newState: { text: `${RUN} Aviso corregido`, version: 2 },
    });
    const [replyAudit] = await audits(original.id, 'news.reply.updated');
    expect(replyAudit).toMatchObject({
      actorUserId: employee.userId,
      previousState: { text: `${RUN} línea uno`, version: 1 },
      newState: { text: `${RUN} línea uno\nlínea dos`, version: 2 },
    });

    // Guardar sin cambios (incluso con una versión vieja): 200, sin escritura ni auditoría.
    const auditsBefore = await prisma.auditLog.count({ where: { entityId: news.id } });
    const unchanged = await edit(employee, news.id, { text: `${RUN} Aviso corregido`, version: 1 });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.news.version).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: news.id } })).toBe(auditsBefore);
    expect(
      (await prisma.newsReport.findUniqueOrThrow({ where: { id: news.id } })).updatedAt,
    ).toEqual(newsRow.updatedAt);
  });

  it('el ADMIN edita y elimina lo propio; un usuario ajeno no puede ni con requests manuales; el ADMIN modera sin editar', async () => {
    const adminNews = await syntheticNews('Aviso del administrador', admin.userId);
    expect((await edit(admin, adminNews.id, { text: `${RUN} propio`, version: 1 })).status).toBe(
      200,
    );
    const employeeReply = await reply(adminNews.id, employee, 'respuesta de la persona');

    const forbidden = [
      await edit(employee, adminNews.id, { text: `${RUN} ajeno`, version: 2 }),
      await remove(employee, adminNews.id, 2),
      await edit(other, `${adminNews.id}/replies/${employeeReply.id}`, {
        text: `${RUN} ajeno`,
        version: 1,
      }),
      await remove(other, `${adminNews.id}/replies/${employeeReply.id}`, 1),
      // El ADMIN modera (elimina) pero no edita palabras ajenas.
      await edit(admin, `${adminNews.id}/replies/${employeeReply.id}`, {
        text: `${RUN} moderado`,
        version: 1,
      }),
    ];
    expect(forbidden.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
    // El autor nunca viaja en el cuerpo: un request manual que lo envía se rechaza.
    const spoofed = await edit(employee, adminNews.id, {
      text: `${RUN} con autor`,
      version: 2,
      authorUserId: employee.userId,
    });
    expect(spoofed.status).toBe(400);
    expect(
      (await prisma.newsReply.findUniqueOrThrow({ where: { id: employeeReply.id } })).text,
    ).toBe(`${RUN} respuesta de la persona`);

    const moderated = await remove(admin, `${adminNews.id}/replies/${employeeReply.id}`, 1);
    expect(moderated.status).toBe(200);
    expect(moderated.body.reply).toMatchObject({
      id: employeeReply.id,
      deleted: true,
      text: null,
      author: { displayName: `Sintético ${NAME_TAG}` },
      permissions: { canEdit: false, canDelete: false },
    });
    expect(
      await prisma.newsReply.findUniqueOrThrow({ where: { id: employeeReply.id } }),
    ).toMatchObject({ authorUserId: employee.userId, deletedByUserId: admin.userId });
    const [moderation] = await audits(employeeReply.id, 'news.reply.deleted');
    expect(moderation).toMatchObject({
      actorUserId: admin.userId,
      newState: { deleted: true, authorUserId: employee.userId, moderated: true },
    });

    const ownDelete = await remove(admin, adminNews.id, 2);
    expect(ownDelete.status).toBe(200);
    const [ownAudit] = await audits(adminNews.id, 'news.deleted');
    expect(ownAudit).toMatchObject({ actorUserId: admin.userId, newState: { moderated: false } });

    // Una novedad registrada por el ADMIN a nombre de la persona: la persona
    // que reporta NO es su autora (no se habilita por coincidencia de empleado).
    const onBehalf = await syntheticNews(
      'Reportada por la persona, cargada por ADMIN',
      admin.userId,
    );
    expect((await edit(employee, onBehalf.id, { text: `${RUN} intento`, version: 1 })).status).toBe(
      403,
    );
  });

  it('una novedad antigua sin autor de carga: nadie la edita, el ADMIN la modera, sin atribución inventada', async () => {
    const legacy = await syntheticNews('Aviso antiguo sin autor', null);
    for (const actor of [employee, admin, other]) {
      expect((await edit(actor, legacy.id, { text: `${RUN} x`, version: 1 })).status).toBe(403);
    }
    expect((await remove(employee, legacy.id, 1)).status).toBe(403);
    const deleted = await remove(admin, legacy.id, 1);
    expect(deleted.status).toBe(200);
    expect(deleted.body.news).toMatchObject({
      deleted: true,
      text: null,
      employee: { id: employeeId },
      permissions: { canEdit: false, canDelete: false, canReply: false },
    });
    const row = await prisma.newsReport.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(row).toMatchObject({ recordedByUserId: null, deletedByUserId: admin.userId });
    const [audit] = await audits(legacy.id, 'news.deleted');
    expect(audit).toMatchObject({
      actorUserId: admin.userId,
      newState: { authorUserId: null, moderated: true },
    });
  });

  it('dos ediciones simultáneas: una gana y la otra recibe conflicto sin pisarla; versión vieja → 409', async () => {
    const news = await syntheticNews('Concurrencia de edición', employee.userId);
    const target = await reply(news.id, employee, 'texto base');
    const results = await Promise.all(
      ['A', 'B'].map((tag) =>
        edit(employee, `${news.id}/replies/${target.id}`, {
          text: `${RUN} versión ${tag}`,
          version: 1,
        }),
      ),
    );
    const statuses = results.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);
    const winner = results.find((response) => response.status === 200);
    const loser = results.find((response) => response.status === 409);
    expect(loser?.body.error.code).toBe('NEWS_MESSAGE_VERSION_CONFLICT');
    const row = await prisma.newsReply.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.text).toBe(winner?.body.reply.text);
    expect(row.version).toBe(2);
    expect(await audits(target.id, 'news.reply.updated')).toHaveLength(1);

    const stale = await edit(employee, `${news.id}/replies/${target.id}`, {
      text: `${RUN} pantalla vieja`,
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('NEWS_MESSAGE_VERSION_CONFLICT');
    expect((await prisma.newsReply.findUniqueOrThrow({ where: { id: target.id } })).text).toBe(
      row.text,
    );
  });

  it('carrera editar/eliminar y doble eliminación: un solo resultado, auditoría única y sin editar lo eliminado', async () => {
    const news = await syntheticNews('Carreras', employee.userId);
    const raced = await reply(news.id, employee, 'en carrera');
    const [edited, deleted] = await Promise.all([
      edit(employee, `${news.id}/replies/${raced.id}`, { text: `${RUN} editado`, version: 1 }),
      remove(employee, `${news.id}/replies/${raced.id}`, 1),
    ]);
    const statuses = [edited.status, deleted.status].sort();
    expect(statuses).toEqual([200, 409]);
    const row = await prisma.newsReply.findUniqueOrThrow({ where: { id: raced.id } });
    if (deleted.status === 200) {
      expect(row.deletedAt).not.toBeNull();
      expect(row.text).toBe(`${RUN} en carrera`);
      expect(['NEWS_MESSAGE_DELETED', 'NEWS_MESSAGE_VERSION_CONFLICT']).toContain(
        edited.body.error.code,
      );
    } else {
      expect(row.deletedAt).toBeNull();
      expect(row.text).toBe(`${RUN} editado`);
      expect(deleted.body.error.code).toBe('NEWS_MESSAGE_VERSION_CONFLICT');
    }
    const raceAudits =
      (await audits(raced.id, 'news.reply.updated')).length +
      (await audits(raced.id, 'news.reply.deleted')).length;
    expect(raceAudits).toBe(1);

    const twice = await reply(news.id, employee, 'doble eliminación');
    const both = await Promise.all([
      remove(employee, `${news.id}/replies/${twice.id}`, 1),
      remove(admin, `${news.id}/replies/${twice.id}`, 1),
    ]);
    expect(both.map((response) => response.status)).toEqual([200, 200]);
    expect(both.every((response) => response.body.reply.deleted === true)).toBe(true);
    const repeat = await remove(employee, `${news.id}/replies/${twice.id}`, 1);
    expect(repeat.status).toBe(200);
    expect(await audits(twice.id, 'news.reply.deleted')).toHaveLength(1);
    const editDeleted = await edit(employee, `${news.id}/replies/${twice.id}`, {
      text: `${RUN} revivir`,
      version: 2,
    });
    expect(editDeleted.status).toBe(409);
    expect(editDeleted.body.error.code).toBe('NEWS_MESSAGE_DELETED');
    expect((await prisma.newsReply.findUniqueOrThrow({ where: { id: twice.id } })).text).toBe(
      `${RUN} doble eliminación`,
    );
  });

  it('eliminar la novedad original conserva sus respuestas y la conversación sigue; sin respuestas queda cerrada', async () => {
    const withReplies = await syntheticNews('Original con conversación', employee.userId);
    const first = await reply(withReplies.id, admin, 'primera');
    await reply(withReplies.id, other, 'segunda', first.id);
    const before = await prisma.newsReply.findMany({
      where: { newsReportId: withReplies.id },
      orderBy: { id: 'asc' },
    });
    const deleted = await remove(employee, withReplies.id, 1);
    expect(deleted.status).toBe(200);
    expect(deleted.body.news).toMatchObject({
      id: withReplies.id,
      text: null,
      deleted: true,
      editedAt: null,
      replyCount: 2,
      hasConversation: true,
      permissions: { canEdit: false, canDelete: false, canReply: true },
    });
    expect(JSON.stringify(deleted.body)).not.toContain('Original con conversación');
    expect(
      await prisma.newsReply.findMany({
        where: { newsReportId: withReplies.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
    await reply(withReplies.id, other, 'seguimos conversando', first.id);
    expect(
      (await edit(employee, withReplies.id, { text: `${RUN} x`, version: 2 })).body.error.code,
    ).toBe('NEWS_MESSAGE_DELETED');

    const lonely = await syntheticNews('Original sin respuestas', employee.userId);
    expect((await remove(employee, lonely.id, 1)).body.news).toMatchObject({
      hasConversation: false,
      permissions: { canReply: false },
    });
    const closed = await request(app)
      .post(`/api/v1/news/${lonely.id}/replies`)
      .set(as(other))
      .set('Idempotency-Key', key())
      .send({ text: `${RUN} no debería` });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('NEWS_CONVERSATION_CLOSED');
    expect(await prisma.newsReply.count({ where: { newsReportId: lonely.id } })).toBe(0);
  });

  it('citas de mensajes editados y eliminados, aun fuera de la página cargada; no se cita un eliminado', async () => {
    const news = await syntheticNews('Citas', employee.userId);
    const oldest = await prisma.newsReply.create({
      data: {
        newsReportId: news.id,
        authorUserId: employee.userId,
        text: `${RUN} texto original citado`,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      select: { id: true },
    });
    await prisma.newsReply.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        newsReportId: news.id,
        authorUserId: admin.userId,
        text: `${RUN} relleno-${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 2, 0, index)),
      })),
    });
    const quoting = await reply(news.id, other, 'cito la más vieja', oldest.id);

    expect(
      (
        await edit(employee, `${news.id}/replies/${oldest.id}`, {
          text: `${RUN} texto corregido`,
          version: 1,
        })
      ).status,
    ).toBe(200);
    const afterEdit = await request(app).get(`/api/v1/news/${news.id}/replies`).set(as(other));
    expect(afterEdit.body.replies.some((item: { id: string }) => item.id === oldest.id)).toBe(
      false,
    );
    const quoted = afterEdit.body.replies.find((item: { id: string }) => item.id === quoting.id);
    expect(quoted.quote).toMatchObject({
      id: oldest.id,
      text: `${RUN} texto corregido`,
      deleted: false,
      editedAt: expect.any(String),
    });

    expect((await remove(employee, `${news.id}/replies/${oldest.id}`, 2)).status).toBe(200);
    const afterDelete = await request(app).get(`/api/v1/news/${news.id}/replies`).set(as(other));
    const quotedDeleted = afterDelete.body.replies.find(
      (item: { id: string }) => item.id === quoting.id,
    );
    expect(quotedDeleted.quote).toEqual({
      id: oldest.id,
      text: null,
      author: { displayName: `Sintético ${NAME_TAG}` },
      deleted: true,
      editedAt: null,
    });
    expect(JSON.stringify(afterDelete.body)).not.toMatch(/texto (original citado|corregido)/);
    const older = await request(app)
      .get(`/api/v1/news/${news.id}/replies`)
      .query({
        beforeCreatedAt: afterDelete.body.nextCursor.createdAt,
        beforeId: afterDelete.body.nextCursor.id,
      })
      .set(as(other));
    expect(older.body.replies[0]).toMatchObject({
      id: oldest.id,
      deleted: true,
      text: null,
      quote: null,
      editedAt: null,
    });

    const quoteDeleted = await request(app)
      .post(`/api/v1/news/${news.id}/replies`)
      .set(as(other))
      .set('Idempotency-Key', key())
      .send({ text: `${RUN} cito lo eliminado`, quotedReplyId: oldest.id });
    expect(quoteDeleted.status).toBe(409);
    expect(quoteDeleted.body.error.code).toBe('NEWS_REPLY_QUOTE_DELETED');
  });

  it('reintentar un envío viejo después de editarlo o eliminarlo devuelve el estado actual, nunca el texto original', async () => {
    const news = await syntheticNews('Idempotencia con edición', employee.userId);
    const idem = key();
    const body = { text: `${RUN} primer texto enviado` };
    const post = () =>
      request(app)
        .post(`/api/v1/news/${news.id}/replies`)
        .set(as(employee))
        .set('Idempotency-Key', idem)
        .send(body);
    const created = await post();
    expect(created.status).toBe(201);
    await edit(employee, `${news.id}/replies/${created.body.reply.id}`, {
      text: `${RUN} texto editado`,
      version: 1,
    });
    const replayAfterEdit = await post();
    expect(replayAfterEdit.status).toBe(201);
    expect(replayAfterEdit.body.reply).toMatchObject({
      id: created.body.reply.id,
      text: `${RUN} texto editado`,
      version: 2,
    });
    await remove(employee, `${news.id}/replies/${created.body.reply.id}`, 2);
    const replayAfterDelete = await post();
    expect(replayAfterDelete.body.reply).toMatchObject({
      id: created.body.reply.id,
      deleted: true,
      text: null,
    });
    expect(JSON.stringify(replayAfterDelete.body)).not.toMatch(/primer texto|texto editado/);
    expect(await prisma.newsReply.count({ where: { newsReportId: news.id } })).toBe(1);

    const newsKey = key();
    const newsBody = { text: `${RUN} novedad para reintentar` };
    const postNews = () =>
      request(app)
        .post('/api/v1/news')
        .set(as(employee))
        .set('Idempotency-Key', newsKey)
        .send(newsBody);
    const createdNews = await postNews();
    expect(createdNews.status).toBe(201);
    const newsId = createdNews.body.news.id as string;
    await edit(employee, newsId, { text: `${RUN} novedad corregida`, version: 1 });
    expect((await postNews()).body.news).toMatchObject({
      id: newsId,
      text: `${RUN} novedad corregida`,
    });
    await remove(employee, newsId, 2);
    const replayDeletedNews = await postNews();
    expect(replayDeletedNews.body.news).toMatchObject({ id: newsId, deleted: true, text: null });
    expect(JSON.stringify(replayDeletedNews.body)).not.toMatch(
      /novedad (para reintentar|corregida)/,
    );

    // Inicio y la tarjeta de Más: la eliminada no aparece ni deja huecos.
    const dashboard = await request(app).get('/api/v1/dashboard').set(as(admin));
    expect(dashboard.status).toBe(200);
    const latest = dashboard.body.latestNews as { id: string; text: string }[];
    expect(latest.some((item) => item.id === newsId)).toBe(false);
    const liveCount = await prisma.newsReport.count({ where: { deletedAt: null } });
    expect(latest).toHaveLength(Math.min(3, liveCount));
    expect(JSON.stringify(dashboard.body)).not.toMatch(/novedad (para reintentar|corregida)/);
    const summary = await request(app).get('/api/v1/more/summary').set(as(employee));
    expect(summary.body.news.total).toBe(
      await prisma.newsReport.count({ where: { deletedAt: null } }),
    );

    const history = await request(app).get('/api/v1/news?pageSize=50').set(as(employee));
    const marker = history.body.news.find((item: { id: string }) => item.id === newsId);
    expect(marker).toMatchObject({ deleted: true, text: null });
  }, 60_000);

  it('contadores y última respuesta solo cuentan las vigentes; los marcadores conservan su lugar en la paginación', async () => {
    const news = await syntheticNews('Contadores', employee.userId);
    const ids = Array.from({ length: 22 }, () => crypto.randomUUID());
    await prisma.newsReply.createMany({
      data: ids.map((id, index) => ({
        id,
        newsReportId: news.id,
        authorUserId: index % 2 === 0 ? admin.userId : employee.userId,
        text: `${RUN} contador-${index}`,
        createdAt: new Date(Date.UTC(2026, 9, 3, 0, index)),
      })),
    });
    const newest = ids[21] as string;
    const secondNewest = ids[20] as string;
    const deletion = await remove(employee, `${news.id}/replies/${newest}`, 1);
    expect(deletion.status).toBe(200);
    expect(deletion.body.conversation).toEqual({
      replyCount: 21,
      hasConversation: true,
      lastReply: {
        createdAt: new Date(Date.UTC(2026, 9, 3, 0, 20)).toISOString(),
        author: { displayName: 'Administrador' },
      },
    });
    expect((await remove(admin, `${news.id}/replies/${secondNewest}`, 1)).status).toBe(200);

    const history = await request(app).get('/api/v1/news?pageSize=50').set(as(employee));
    const listed = history.body.news.find((item: { id: string }) => item.id === news.id);
    expect(listed).toMatchObject({
      replyCount: 20,
      hasConversation: true,
      lastReply: { createdAt: new Date(Date.UTC(2026, 9, 3, 0, 19)).toISOString() },
    });

    const first = await request(app).get(`/api/v1/news/${news.id}/replies`).set(as(employee));
    expect(first.body.replies).toHaveLength(20);
    expect(first.body.replies.at(-1)).toMatchObject({ id: newest, deleted: true, text: null });
    expect(first.body.replies.at(-2)).toMatchObject({ id: secondNewest, deleted: true });
    const second = await request(app)
      .get(`/api/v1/news/${news.id}/replies`)
      .query({
        beforeCreatedAt: first.body.nextCursor.createdAt,
        beforeId: first.body.nextCursor.id,
      })
      .set(as(employee));
    expect(second.body.replies.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 2));

    await prisma.newsReply.updateMany({
      where: { id: { in: ids.slice(0, 20) } },
      data: { deletedAt: new Date(), deletedByUserId: admin.userId },
    });
    const onlyMarkers = await request(app).get('/api/v1/news?pageSize=50').set(as(employee));
    expect(onlyMarkers.body.news.find((item: { id: string }) => item.id === news.id)).toMatchObject(
      {
        replyCount: 0,
        hasConversation: true,
        lastReply: null,
      },
    );
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
