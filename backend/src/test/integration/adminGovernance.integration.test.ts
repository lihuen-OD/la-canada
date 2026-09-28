import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { hashPin, verifyPin } from '../../auth/pin';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Etapa 5U — gobierno de varios ADMIN contra Neon real (`demo`) por HTTP real:
 * nadie se desactiva a sí mismo, la carrera "A desactiva a B mientras B
 * desactiva a A" nunca deja a los dos inactivos, y el segundo ADMIN tiene su
 * propio perfil y familia, fuera de todo lo operativo. Solo ADMIN sintéticos
 * (`test-5u-gov-<RUN>`); los ADMIN reales y su perfil solo se leen y se verifica
 * que no cambiaron. `afterAll` borra por id y compara conteos globales.
 */

const RUN = `test-5u-gov-${Date.now()}`;
const TAG = RUN.replace(/\d/g, (digit) => 'abcdefghij'[Number(digit)] ?? 'x').replace(/-/g, ' ');
const RACE_ROUNDS = 5;

let app: Express;
const ids: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
const userIds: string[] = [];
let baseline: Record<string, number>;
let realAdmins: unknown;

const realAdminSnapshot = () =>
  prisma.user.findMany({
    where: { role: 'ADMIN', username: { not: { startsWith: 'test-' } } },
    select: { id: true, status: true, updatedAt: true, pinHash: true, personalProfile: true },
    orderBy: { id: 'asc' },
  });

async function globalCounts() {
  return {
    users: await prisma.user.count(),
    userProfiles: await prisma.userProfile.count(),
    birthdays: await prisma.recurringBirthday.count(),
    employees: await prisma.employee.count(),
    sessions: await prisma.session.count(),
    audits: await prisma.auditLog.count(),
    idempotency: await prisma.idempotencyRecord.count(),
  };
}

/** Sesión nueva (las desactivaciones revocan las anteriores). */
async function tokenFor(userId: string) {
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 3600_000),
    },
    select: { id: true },
  });
  return signAccessToken({ userId, sessionId: session.id, role: 'ADMIN' }, accessTokenSecret, 3600);
}
const auth = async (userId: string) => ({ Authorization: `Bearer ${await tokenFor(userId)}` });
const setStatus = async (actor: string, target: string, status: string) =>
  request(app)
    .patch(`/api/v1/admin/users/${target}/status`)
    .set(await auth(actor))
    .send({ status });

beforeAll(async () => {
  baseline = await globalCounts();
  realAdmins = await realAdminSnapshot();
  app = createApp();
  for (const key of ['a', 'c'] as const) {
    const user = await prisma.user.create({
      data: {
        username: `${RUN}-${key}`,
        role: 'ADMIN',
        status: 'ACTIVE',
        pinHash: await hashPin('9931'),
      },
      select: { id: true },
    });
    ids[key] = user.id;
    userIds.push(user.id);
  }
  // El SEGUNDO ADMIN se crea por el endpoint real de la etapa, desde A.
  const created = await request(app)
    .post('/api/v1/admin/users/admins')
    .set(await auth(ids.a))
    .send({ displayName: `Segundo ${TAG}`, pin: '0456' });
  expect(created.status).toBe(201);
  ids.b = created.body.user.id;
  userIds.push(ids.b);
}, 60_000);

afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: userIds } } });
  const members = await prisma.recurringBirthday.findMany({
    where: { ownerUserId: { in: userIds } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...userIds, ...members.map((m) => m.id)] } },
      ],
    },
  });
  await prisma.recurringBirthday.deleteMany({ where: { ownerUserId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  expect(await globalCounts()).toEqual(baseline);
  expect(await realAdminSnapshot()).toEqual(realAdmins);
}, 60_000);

describe('un ADMIN nunca se desactiva a sí mismo', () => {
  it.each(['SUSPENDED', 'DEACTIVATED'])(
    '%s sobre la propia cuenta → 409, sigue ACTIVE',
    async (status) => {
      const response = await setStatus(ids.a, ids.a, status);
      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: 'AUTH_SELF_STATUS_CHANGE',
        message: 'No podés desactivar tu propia cuenta.',
      });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.a } })).status).toBe('ACTIVE');
    },
  );
});

describe('carrera real: dos ADMIN desactivándose mutuamente', () => {
  it(`en ${RACE_ROUNDS} rondas, nunca quedan los dos inactivos`, async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < RACE_ROUNDS; round += 1) {
      const [headersA, headersB] = await Promise.all([auth(ids.a), auth(ids.b)]);
      const [ab, ba] = await Promise.all([
        request(app)
          .patch(`/api/v1/admin/users/${ids.b}/status`)
          .set(headersA)
          .send({ status: 'DEACTIVATED' }),
        request(app)
          .patch(`/api/v1/admin/users/${ids.a}/status`)
          .set(headersB)
          .send({ status: 'DEACTIVATED' }),
      ]);
      const statuses = [ab.status, ba.status];
      outcomes.push(`${ab.status}/${ba.status}`);
      // Exactamente uno gana; el perdedor queda afuera por el bloqueo (409) o,
      // si su pedido llegó después de revocada su sesión, por autenticación (401).
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      for (const loser of [ab, ba].filter((response) => response.status !== 200)) {
        expect([401, 409]).toContain(loser.status);
        if (loser.status === 409) expect(loser.body.error.code).toBe('ADMIN_ACTOR_INACTIVE');
      }
      const rows = await prisma.user.findMany({
        where: { id: { in: [ids.a, ids.b] } },
        select: { id: true, status: true },
      });
      expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
      // C (otro ADMIN activo) reactiva al que quedó afuera para la ronda siguiente.
      const loserId = rows.find((row) => row.status !== 'ACTIVE')?.id as string;
      expect((await setStatus(ids.c, loserId, 'ACTIVE')).status).toBe(200);
    }
    // eslint-disable-next-line no-console -- evidencia de la carrera en el reporte
    console.log(`[5u-race] ${outcomes.join(' ')}`);
  }, 60_000);
});

describe('el segundo ADMIN (creado por el endpoint)', () => {
  it('usa su propio UserProfile y su propia familia; no recibe a Vicky ni Felicitas', async () => {
    const headers = await auth(ids.b);
    const profile = await request(app).get('/api/v1/me/profile').set(headers);
    expect(profile.body).toEqual({
      kind: 'personal',
      profile: { displayName: `Segundo ${TAG}`, birthDate: null },
    });
    const empty = await request(app).get('/api/v1/me/family').set(headers);
    expect(empty.body.family).toEqual([]);
    const added = await request(app)
      .post('/api/v1/me/family')
      .set(headers)
      .send({ name: `Hija ${TAG}`, relation: 'CHILD', birthDate: '2015-04-03' });
    expect(added.status).toBe(201);
    const family = (await request(app).get('/api/v1/me/family').set(headers)).body.family as {
      name: string;
    }[];
    expect(family.map((member) => member.name)).toEqual([`Hija ${TAG}`]);
    expect(
      await prisma.recurringBirthday.count({
        where: { slug: { in: ['vicky', 'felicitas'] }, ownerUserId: ids.b },
      }),
    ).toBe(0);
    expect(await prisma.userProfile.count({ where: { userId: ids.b } })).toBe(1);
    // La familia de A (otro ADMIN) no ve a la de B.
    expect(
      (
        await request(app)
          .get('/api/v1/me/family')
          .set(await auth(ids.a))
      ).body.family,
    ).toEqual([]);
  });

  it('no aparece en empleados, Tareas, Desempeño ni selectores laborales', async () => {
    const today = toLocalDate(new Date(), config.businessTimeZone);
    const range = `from=${formatLocalDate(addDays(today, -6))}&to=${formatLocalDate(today)}`;
    const headers = await auth(ids.a);
    for (const path of [
      '/api/v1/tasks/employees',
      '/api/v1/tasks',
      '/api/v1/employees',
      '/api/v1/employees/profiles',
      `/api/v1/performance/summary?${range}`,
    ]) {
      const response = await request(app).get(path).set(headers);
      expect(response.status, path).toBe(200);
      expect(JSON.stringify(response.body), path).not.toContain(ids.b);
      expect(JSON.stringify(response.body), path).not.toContain(`Segundo ${TAG}`);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.b } })).employeeId).toBeNull();
  });
});

describe('otro ADMIN administra al segundo', () => {
  it('le corrige el nombre visible (UserProfile), sin tocar username, rol, estado ni sesiones', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: ids.b },
      select: { username: true, role: true, status: true, pinHash: true },
    });
    const sessionsBefore = await prisma.session.count({
      where: { userId: ids.b, revokedAt: null },
    });
    const response = await request(app)
      .patch(`/api/v1/admin/users/${ids.b}/display-name`)
      .set(await auth(ids.a))
      .send({ displayName: `  Segundo   Corregido ${TAG} ` });
    expect(response.status).toBe(200);
    expect(response.body.user.displayName).toBe(`Segundo Corregido ${TAG}`);
    expect(
      (await prisma.userProfile.findUniqueOrThrow({ where: { userId: ids.b } })).displayName,
    ).toBe(`Segundo Corregido ${TAG}`);
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { id: ids.b },
        select: { username: true, role: true, status: true, pinHash: true },
      }),
    ).toEqual(before);
    expect(await prisma.session.count({ where: { userId: ids.b, revokedAt: null } })).toBe(
      sessionsBefore,
    );
    for (const extra of [{ username: 'x' }, { role: 'EMPLOYEE' }, { userId: ids.a }]) {
      const bad = await request(app)
        .patch(`/api/v1/admin/users/${ids.b}/display-name`)
        .set(await auth(ids.a))
        .send({ displayName: 'Otro Nombre', ...extra });
      expect(bad.status).toBe(400);
    }
    const invalidId = await request(app)
      .patch('/api/v1/admin/users/no-es-uuid/display-name')
      .set(await auth(ids.a))
      .send({ displayName: 'Otro Nombre' });
    expect(invalidId.status).toBe(400);
  });

  it('le resetea el PIN (revoca sus sesiones) y el PIN nuevo funciona', async () => {
    await tokenFor(ids.b);
    const response = await request(app)
      .post(`/api/v1/admin/users/${ids.b}/reset-pin`)
      .set(await auth(ids.a))
      .send({ pin: '0789' });
    expect(response.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: ids.b } });
    expect(await verifyPin(row.pinHash as string, '0789')).toBe(true);
    expect(await verifyPin(row.pinHash as string, '0456')).toBe(false);
    expect(await prisma.session.count({ where: { userId: ids.b, revokedAt: null } })).toBe(0);
  });

  it('lo suspende y lo reactiva mientras quede otro ADMIN activo', async () => {
    const suspended = await setStatus(ids.a, ids.b, 'SUSPENDED');
    expect(suspended.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.b } })).status).toBe(
      'SUSPENDED',
    );
    const options = (await request(app).get('/api/v1/auth/login-options')).body.options as {
      id: string;
    }[];
    expect(options.some((option) => option.id === ids.b)).toBe(false);
    const reactivated = await setStatus(ids.a, ids.b, 'ACTIVE');
    expect(reactivated.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.b } })).status).toBe('ACTIVE');
  });
});
