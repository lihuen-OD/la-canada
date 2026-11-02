import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * 🥬 Huerta — cultivos y registros contra Neon real por HTTP real: la rama
 * `demo` (autorizada por el usuario el 2026-11-02, `npm run test:integration`)
 * o una rama aislada (`test:integration:isolated` con `LA_CANADA_ENV_FILE`);
 * nunca `production`: permisos, siembra directa y almácigo, fechas previstas,
 * trasplantes parciales y cierre explícito de pendientes, fechas inválidas,
 * correcciones (sin cambios, versión vieja, fechas contra la siembra),
 * anulación con motivo, archivo y reapertura, concurrencia, idempotencia,
 * Registros con filtros y paginación, y que Actividades y Desempeño de la
 * Huerta no cambian. La base tiene datos reales: nunca se edita una fila
 * existente, todo lo creado lleva `test-crops-<RUN>` y `afterAll` borra solo
 * esos ids.
 */

const RUN = `test-crops-${Date.now()}`;
const TZ = config.businessTimeZone;
const SLOW = 120_000;
const api = '/api/v1/kitchen-garden';
const today = toLocalDate(new Date(), TZ);
const day = (offset: number) => formatLocalDate(addDays(today, offset));

interface Actor {
  userId: string;
  token: string;
}
let app: Express;
let admin: Actor;
let ana: Actor; // participante
let beto: Actor; // participante
let outsider: Actor; // usuario activo que no participa
let retired: Actor; // participante desactivado
const participant: Record<'ana' | 'beto' | 'retired', string> = { ana: '', beto: '', retired: '' };
const userIds: string[] = [];
const employeeIds: string[] = [];
const participantIds: string[] = [];

async function actorFor(role: 'ADMIN' | 'EMPLOYEE', suffix: string) {
  let employeeId: string | undefined;
  if (role === 'EMPLOYEE') {
    employeeId = (
      await prisma.employee.create({
        data: {
          code: `${RUN}-${suffix}`,
          displayName: `Persona ${suffix} ${RUN}`,
          role: 'Test',
          colorHex: '#4a7c59',
        },
        select: { id: true },
      })
    ).id;
    employeeIds.push(employeeId);
  }
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    select: { id: true },
  });
  return {
    userId: user.id,
    token: await signAccessToken(
      { userId: user.id, sessionId: session.id, role },
      accessTokenSecret,
      3600,
    ),
  };
}

async function participate(actor: Actor, active = true) {
  const row = await prisma.kitchenGardenParticipant.create({
    data: { userId: actor.userId, active },
    select: { id: true },
  });
  participantIds.push(row.id);
  return row.id;
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const key = () => crypto.randomUUID().replace(/-/g, '');

interface RecordDto {
  id: string;
  type: string;
  performedOn: string;
  performedBy: { id: string; displayName: string };
  recordedBy: { displayName: string };
  location: string;
  quantity: string | null;
  quantityUnit: string | null;
  version: number;
}
interface BatchDto {
  id: string;
  name: string;
  version: number;
  archived: boolean;
  crop: { id: string; name: string };
  transplantPlan: {
    pending: boolean;
    expectedDate: string | null;
    status: string | null;
    closedAt: string | null;
  };
  sowing: RecordDto | null;
  transplants: RecordDto[];
}

const sow = (actor: Actor, body: object, idempotencyKey = key()) =>
  request(app)
    .post(`${api}/batches`)
    .set(as(actor))
    .set('Idempotency-Key', idempotencyKey)
    .send(body);

async function sown(actor: Actor, overrides: object = {}) {
  const response = await sow(actor, {
    cropName: `${RUN} Lechuga`,
    batchName: `${RUN} tanda`,
    performedOn: day(-10),
    performedByParticipantId: participant.ana,
    method: 'DIRECT',
    location: 'Cantero 1',
    ...overrides,
  });
  expect(response.status).toBe(201);
  return response.body.batch as BatchDto;
}

const transplant = (actor: Actor, batch: { id: string; version: number }, body: object = {}) =>
  request(app)
    .post(`${api}/batches/${batch.id}/transplants`)
    .set(as(actor))
    .set('Idempotency-Key', key())
    .send({
      batchVersion: batch.version,
      performedOn: day(-2),
      performedByParticipantId: participant.beto,
      location: 'Cantero 5',
      remainingPending: true,
      ...body,
    });

const detail = async (id: string) =>
  (await request(app).get(`${api}/batches/${id}`).set(as(outsider))).body.batch as BatchDto;

const audits = (entityId: string, action: string) =>
  prisma.auditLog.count({ where: { entityId, action } });

/** Respuestas de Actividades y Desempeño de la Huerta, sin las marcas de tiempo. */
async function gardenSnapshot() {
  const activities = await request(app).get(`${api}/activities`).set(as(admin));
  const performance = await request(app)
    .get(`${api}/performance/summary?from=${day(-6)}&to=${day(0)}`)
    .set(as(admin));
  const strip = (body: Record<string, unknown>) =>
    JSON.parse(JSON.stringify(body, (k, v) => (k === 'generatedAt' ? undefined : v))) as unknown;
  return { activities: strip(activities.body), performance: strip(performance.body) };
}
let gardenBefore: Awaited<ReturnType<typeof gardenSnapshot>>;

beforeAll(async () => {
  // `demo` (autorizada) o una rama aislada; nunca production (las guardas lo impiden antes).
  expect(['demo', 'isolated']).toContain(process.env.DATABASE_TARGET);
  app = createApp();
  admin = await actorFor('ADMIN', 'admin');
  ana = await actorFor('EMPLOYEE', 'ana');
  beto = await actorFor('EMPLOYEE', 'beto');
  outsider = await actorFor('EMPLOYEE', 'fuera');
  retired = await actorFor('EMPLOYEE', 'retirado');
  participant.ana = await participate(ana);
  participant.beto = await participate(beto);
  participant.retired = await participate(retired, false);
  gardenBefore = await gardenSnapshot();
}, SLOW);

afterAll(async () => {
  const batchIds = (
    await prisma.kitchenGardenBatch.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const recordIds = (
    await prisma.kitchenGardenCropRecord.findMany({
      where: { batchId: { in: batchIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  const cropIds = (
    await prisma.kitchenGardenCrop.findMany({
      where: { createdByUserId: { in: userIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...batchIds, ...recordIds, ...cropIds, ...participantIds] } },
      ],
    },
  });
  await prisma.kitchenGardenCropRecord.deleteMany({ where: { id: { in: recordIds } } });
  await prisma.kitchenGardenBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.kitchenGardenCrop.deleteMany({ where: { id: { in: cropIds } } });
  await prisma.kitchenGardenParticipant.deleteMany({ where: { id: { in: participantIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  expect(await prisma.kitchenGardenBatch.count({ where: { id: { in: batchIds } } })).toBe(0);
  expect(await prisma.kitchenGardenCrop.count({ where: { name: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: RUN } } })).toBe(0);
}, SLOW);

describe('🥬 cultivos y registros (Neon real)', { timeout: SLOW }, () => {
  it('permisos: sin sesión 401; quien no participa consulta pero no escribe; un participante sí', async () => {
    expect((await request(app).get(`${api}/batches`)).status).toBe(401);
    expect((await request(app).post(`${api}/batches`).send({})).status).toBe(401);
    expect((await request(app).get(`${api}/batches`).set(as(outsider))).status).toBe(200);
    expect((await request(app).get(`${api}/crop-records`).set(as(outsider))).status).toBe(200);
    const denied = await sow(outsider, {
      cropName: `${RUN} Lechuga`,
      batchName: `${RUN} sin permiso`,
      performedOn: day(-1),
      performedByParticipantId: participant.ana,
      method: 'DIRECT',
      location: 'Cantero 1',
    });
    expect(denied.status).toBe(403);
    const list = await request(app).get(`${api}/batches`).set(as(ana));
    expect(list.body.viewer).toEqual({ canRecord: true, participantId: participant.ana });
  });

  it('siembra directa: quien la hizo y quien la registró por separado; sin trasplante pendiente', async () => {
    const batch = await sown(ana, {
      performedByParticipantId: participant.beto,
      quantity: '200',
      quantityUnit: 'SEEDS',
    });
    expect(batch.transplantPlan).toMatchObject({ pending: false, expectedDate: null });
    expect(batch.sowing).toMatchObject({
      performedBy: { id: participant.beto },
      quantity: '200',
      quantityUnit: 'SEEDS',
    });
    const row = await prisma.kitchenGardenCropRecord.findUniqueOrThrow({
      where: { id: batch.sowing!.id },
    });
    expect(row).toMatchObject({
      recordedByUserId: ana.userId,
      performedByParticipantId: participant.beto,
    });
    expect(await audits(batch.id, 'kitchen_garden.batch_sown')).toBe(1);
  });

  it('almácigo con fecha prevista: etiqueta del backend y orden (pendientes con fecha más antigua primero)', async () => {
    const later = await sown(ana, {
      method: 'SEEDBED',
      batchName: `${RUN} almácigo tarde`,
      expectedTransplantDate: day(10),
    });
    const past = await sown(ana, {
      method: 'SEEDBED',
      batchName: `${RUN} almácigo pasado`,
      expectedTransplantDate: day(-1),
    });
    const dueToday = await sown(ana, {
      method: 'SEEDBED',
      batchName: `${RUN} almácigo hoy`,
      expectedTransplantDate: day(0),
    });
    expect(later.transplantPlan).toMatchObject({ pending: true, status: 'SCHEDULED' });
    expect(past.transplantPlan.status).toBe('PAST');
    expect(dueToday.transplantPlan.status).toBe('DUE_TODAY');
    const crop = later.crop.id;
    const list = await request(app).get(`${api}/batches?cropId=${crop}&pageSize=50`).set(as(beto));
    const ids = (list.body.batches as BatchDto[]).map((batch) => batch.id);
    expect(ids.slice(0, 3)).toEqual([past.id, dueToday.id, later.id]);
  });

  it('fechas inválidas: futura, prevista antes de la siembra, trasplante antes de la siembra, semillas con fracción', async () => {
    const base = {
      cropName: `${RUN} Tomate`,
      batchName: `${RUN} inválida`,
      performedByParticipantId: participant.ana,
      location: 'Cantero 2',
    };
    expect((await sow(ana, { ...base, performedOn: day(1), method: 'DIRECT' })).status).toBe(400);
    expect(
      (
        await sow(ana, {
          ...base,
          performedOn: day(-3),
          method: 'SEEDBED',
          expectedTransplantDate: day(-4),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await sow(ana, {
          ...base,
          performedOn: day(-3),
          method: 'DIRECT',
          expectedTransplantDate: day(4),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await sow(ana, {
          ...base,
          performedOn: day(-3),
          method: 'DIRECT',
          quantity: '2.5',
          quantityUnit: 'SEEDS',
        })
      ).status,
    ).toBe(400);
    const batch = await sown(ana, { batchName: `${RUN} base fechas`, performedOn: day(-5) });
    expect((await transplant(ana, batch, { performedOn: day(-6) })).status).toBe(400);
    expect((await transplant(ana, batch, { performedOn: day(1) })).status).toBe(400);
    expect(
      await prisma.kitchenGardenCropRecord.count({
        where: { batchId: batch.id, type: 'TRANSPLANT' },
      }),
    ).toBe(0);
    // El participante desactivado no se puede elegir para un hecho nuevo.
    expect(
      (
        await sow(ana, {
          ...base,
          performedOn: day(-1),
          method: 'DIRECT',
          performedByParticipantId: participant.retired,
        })
      ).status,
    ).toBe(400);
  });

  it('trasplantes parciales: conservar o cambiar la fecha prevista y cerrar los pendientes de forma explícita', async () => {
    let batch = await sown(ana, {
      method: 'SEEDBED',
      batchName: `${RUN} parcial`,
      performedOn: day(-20),
      expectedTransplantDate: day(-5),
    });
    const first = await transplant(ana, batch, { performedOn: day(-6), quantity: '20' });
    expect(first.status).toBe(201);
    batch = first.body.batch;
    expect(batch.transplantPlan).toMatchObject({ pending: true, expectedDate: day(-5) });
    const second = await transplant(beto, batch, {
      performedOn: day(-4),
      expectedTransplantDate: day(3),
    });
    batch = second.body.batch;
    expect(batch.transplantPlan).toMatchObject({
      pending: true,
      expectedDate: day(3),
      status: 'SCHEDULED',
    });
    const third = await transplant(ana, batch, { performedOn: day(-1), remainingPending: false });
    batch = third.body.batch;
    expect(batch.transplantPlan).toMatchObject({ pending: false, expectedDate: null });
    expect(batch.transplantPlan.closedAt).not.toBeNull();
    expect(batch.transplants.map((row) => row.performedOn)).toEqual([day(-6), day(-4), day(-1)]);
    expect(batch.transplants[0]).toMatchObject({ quantity: '20', quantityUnit: 'SEEDLINGS' });
    // La fecha prevista nunca se convirtió en un hecho: solo hay los tres registrados.
    expect(
      await prisma.kitchenGardenCropRecord.count({
        where: { batchId: batch.id, type: 'TRANSPLANT' },
      }),
    ).toBe(3);
    // Un trasplante sin haberlo programado (siembra directa).
    const direct = await sown(ana, { batchName: `${RUN} directa con trasplante` });
    const unplanned = await transplant(ana, direct, { remainingPending: false });
    expect(unplanned.status).toBe(201);
  });

  it('correcciones: de otra persona, solo lo que cambió, sin cambios no audita, versión vieja 409, fechas contra la siembra', async () => {
    let batch = await sown(beto, { batchName: `${RUN} corregir`, performedOn: day(-15) });
    batch = (await transplant(beto, batch, { performedOn: day(-10), remainingPending: false })).body
      .batch;
    const sowing = batch.sowing!;
    const fix = await request(app)
      .patch(`${api}/crop-records/${sowing.id}`)
      .set(as(ana))
      .send({ version: sowing.version, location: 'Cantero 1 norte' });
    expect(fix.status).toBe(200);
    expect(fix.body.changed).toBe(true);
    const row = await prisma.kitchenGardenCropRecord.findUniqueOrThrow({
      where: { id: sowing.id },
    });
    expect(row).toMatchObject({
      location: 'Cantero 1 norte',
      recordedByUserId: beto.userId,
      version: 2,
    });
    expect(await audits(sowing.id, 'kitchen_garden.crop_record_corrected')).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: sowing.id, action: 'kitchen_garden.crop_record_corrected' },
    });
    expect(audit).toMatchObject({
      actorUserId: ana.userId,
      previousState: { location: 'Cantero 1' },
      newState: { location: 'Cantero 1 norte' },
    });
    const same = await request(app)
      .patch(`${api}/crop-records/${sowing.id}`)
      .set(as(admin))
      .send({ version: 2, location: 'Cantero 1 norte' });
    expect(same.body.changed).toBe(false);
    expect(await audits(sowing.id, 'kitchen_garden.crop_record_corrected')).toBe(1);
    const stale = await request(app)
      .patch(`${api}/crop-records/${sowing.id}`)
      .set(as(admin))
      .send({ version: 1, location: 'Otro' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('GARDEN_CROP_RECORD_CHANGED');
    const afterTransplant = await request(app)
      .patch(`${api}/crop-records/${sowing.id}`)
      .set(as(admin))
      .send({ version: 2, performedOn: day(-9) });
    expect(afterTransplant.status).toBe(400);
  });

  it('dos correcciones simultáneas con la misma versión: una gana, la otra 409 y una sola auditoría', async () => {
    const batch = await sown(ana, { batchName: `${RUN} carrera` });
    const sowing = batch.sowing!;
    const results = await Promise.all([
      request(app)
        .patch(`${api}/crop-records/${sowing.id}`)
        .set(as(ana))
        .send({ version: 1, location: 'A' }),
      request(app)
        .patch(`${api}/crop-records/${sowing.id}`)
        .set(as(beto))
        .send({ version: 1, location: 'B' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await audits(sowing.id, 'kitchen_garden.crop_record_corrected')).toBe(1);
  });

  it('anulación: con motivo; la siembra con trasplantes vigentes no; doble anulación simultánea, una sola', async () => {
    let batch = await sown(ana, { batchName: `${RUN} anular`, performedOn: day(-8) });
    batch = (await transplant(ana, batch, { performedOn: day(-3), remainingPending: false })).body
      .batch;
    const blocked = await request(app)
      .post(`${api}/crop-records/${batch.sowing!.id}/void`)
      .set(as(beto))
      .send({ reason: 'Prueba sintética' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('GARDEN_SOWING_HAS_TRANSPLANTS');
    expect(
      (
        await request(app)
          .post(`${api}/crop-records/${batch.sowing!.id}/void`)
          .set(as(beto))
          .send({})
      ).status,
    ).toBe(400);
    const target = batch.transplants[0]!.id;
    const results = await Promise.all([
      request(app)
        .post(`${api}/crop-records/${target}/void`)
        .set(as(ana))
        .send({ reason: 'Cargado dos veces' }),
      request(app)
        .post(`${api}/crop-records/${target}/void`)
        .set(as(beto))
        .send({ reason: 'Cargado dos veces' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await audits(target, 'kitchen_garden.crop_record_voided')).toBe(1);
    const row = await prisma.kitchenGardenCropRecord.findUniqueOrThrow({ where: { id: target } });
    expect(row.voidReason).toBe('Cargado dos veces');
    expect(row.voidedAt).not.toBeNull();
    // Anulado: no se corrige y deja de verse en la ficha.
    expect(
      (
        await request(app)
          .patch(`${api}/crop-records/${target}`)
          .set(as(admin))
          .send({ version: 1, location: 'X' })
      ).status,
    ).toBe(409);
    expect((await detail(batch.id)).transplants).toHaveLength(0);
  });

  it('archivo: se consulta, no admite hechos ni correcciones; reabrir lo habilita sin perder registros', async () => {
    const batch = await sown(ana, { batchName: `${RUN} archivo` });
    const archived = await request(app)
      .post(`${api}/batches/${batch.id}/archive`)
      .set(as(beto))
      .send({});
    expect(archived.status).toBe(200);
    const again = await request(app)
      .post(`${api}/batches/${batch.id}/archive`)
      .set(as(beto))
      .send({});
    expect(again.body.changed).toBe(false);
    expect(await audits(batch.id, 'kitchen_garden.batch_archived')).toBe(1);
    const fresh = archived.body.batch as BatchDto;
    expect((await transplant(ana, fresh)).status).toBe(409);
    expect(
      (
        await request(app)
          .patch(`${api}/crop-records/${batch.sowing!.id}`)
          .set(as(ana))
          .send({ version: 1, location: 'X' })
      ).status,
    ).toBe(409);
    const archivedList = await request(app)
      .get(`${api}/batches?status=archived&pageSize=50`)
      .set(as(outsider));
    expect((archivedList.body.batches as BatchDto[]).map((row) => row.id)).toContain(batch.id);
    const reopened = await request(app)
      .post(`${api}/batches/${batch.id}/reopen`)
      .set(as(ana))
      .send({});
    expect(reopened.status).toBe(200);
    expect((await transplant(ana, reopened.body.batch, { remainingPending: false })).status).toBe(
      201,
    );
    expect((await detail(batch.id)).sowing).not.toBeNull();
  });

  it('idempotencia: doble envío con la misma clave crea UNA tanda; otro cuerpo con la misma clave, 409', async () => {
    const body = {
      cropName: `${RUN} Acelga`,
      batchName: `${RUN} doble`,
      performedOn: day(-1),
      performedByParticipantId: participant.ana,
      method: 'DIRECT',
      location: 'Cantero 3',
    };
    const sameKey = key();
    const [first, second] = await Promise.all([sow(ana, body, sameKey), sow(ana, body, sameKey)]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.batch.id).toBe(first.body.batch.id);
    expect((await sow(ana, { ...body, location: 'Otro' }, sameKey)).status).toBe(409);
    expect(await prisma.kitchenGardenBatch.count({ where: { name: `${RUN} doble` } })).toBe(1);
  });

  it('Registros: más recientes primero, filtros por tipo, persona, tanda, cultivo y fechas, paginación', async () => {
    const crop = `${RUN} Registros`;
    let batch = await sown(ana, {
      cropName: crop,
      batchName: `${RUN} registros`,
      performedOn: day(-12),
    });
    batch = (await transplant(beto, batch, { performedOn: day(-7), remainingPending: false })).body
      .batch;
    const cropId = batch.crop.id;
    const query = (params: string) =>
      request(app).get(`${api}/crop-records?cropId=${cropId}&${params}`).set(as(outsider));
    const all = await query('pageSize=50');
    expect((all.body.records as RecordDto[]).map((row) => row.type)).toEqual([
      'TRANSPLANT',
      'SOWING',
    ]);
    expect((await query('type=SOWING')).body.total).toBe(1);
    expect((await query(`participantId=${participant.beto}`)).body.total).toBe(1);
    expect((await query(`batchId=${batch.id}`)).body.total).toBe(2);
    expect((await query(`from=${day(-8)}&to=${day(0)}`)).body.total).toBe(1);
    const page1 = await query('pageSize=1');
    expect(page1.body).toMatchObject({ total: 2, totalPages: 2 });
    expect((await query('pageSize=1&page=2')).body.records).toHaveLength(1);
  });

  it('identidades históricas: desactivar a quien hizo un registro conserva su nombre', async () => {
    const batch = await sown(ana, {
      batchName: `${RUN} historia`,
      performedByParticipantId: participant.beto,
    });
    await prisma.kitchenGardenParticipant.update({
      where: { id: participant.beto },
      data: { active: false },
    });
    try {
      expect((await detail(batch.id)).sowing?.performedBy.displayName).toBe(`Persona beto ${RUN}`);
    } finally {
      await prisma.kitchenGardenParticipant.update({
        where: { id: participant.beto },
        data: { active: true },
      });
    }
  });

  it('Actividades y Desempeño de la Huerta no cambian con los cultivos', async () => {
    expect(await gardenSnapshot()).toEqual(gardenBefore);
  });
});
