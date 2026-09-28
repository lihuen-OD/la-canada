import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { hashPin } from '../../auth/pin';
import { login } from '../../auth/authService';
import { TECHNICAL_USERNAME_PATTERN } from '../../auth/adminAccounts';
import { config } from '../../config';
import { addDays, formatLocalDate, toLocalDate } from '../../lib/businessTime';

/**
 * Etapa 5U — alta de un ADMIN adicional contra Neon real (`demo`) por HTTP
 * real. Todo lo creado es sintético (`test-5u-<RUN>` en el actor; los
 * administradores creados se ubican por su auditoría `admin.user.created`) y
 * se borra por id en `afterAll`, verificando conteos globales idénticos a la
 * línea de base. El ADMIN real y su `UserProfile` solo se leen.
 */

const RUN = `test-5u-${Date.now()}`;
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
let employee: Actor;
let employeeId = '';
const userIds: string[] = [];
let baseline: Record<string, number>;
let realAdmins: unknown;

async function globalCounts() {
  return {
    users: await prisma.user.count(),
    userProfiles: await prisma.userProfile.count(),
    employees: await prisma.employee.count(),
    sessions: await prisma.session.count(),
    audits: await prisma.auditLog.count(),
    idempotency: await prisma.idempotencyRecord.count(),
  };
}

async function actor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, linked?: string): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: await hashPin('9931'),
      employeeId: linked,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 3600_000),
    },
    select: { id: true },
  });
  const token = await signAccessToken(
    { userId: user.id, sessionId: session.id, role },
    accessTokenSecret,
    3600,
  );
  return { userId: user.id, token };
}

const as = (who: Actor) => ({ Authorization: `Bearer ${who.token}` });
const post = (who: Actor | null, body: unknown, key?: string) => {
  const call = request(app).post('/api/v1/admin/users/admins');
  if (who) call.set(as(who));
  if (key) call.set('Idempotency-Key', key);
  return call.send(body as object);
};
const createdIds = async () =>
  (
    await prisma.auditLog.findMany({
      where: { action: 'admin.user.created', actorUserId: { in: userIds } },
      select: { entityId: true },
    })
  ).map((row) => row.entityId);

beforeAll(async () => {
  baseline = await globalCounts();
  realAdmins = await prisma.user.findMany({
    where: { role: 'ADMIN', username: { not: { startsWith: 'test-' } } },
    select: { id: true, username: true, status: true, updatedAt: true, personalProfile: true },
  });
  app = createApp();
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Empleado ${NAME_TAG}`,
      role: 'Otro',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = emp.id;
  admin = await actor('ADMIN', 'admin');
  employee = await actor('EMPLOYEE', 'emp', employeeId);
}, 60_000);

afterAll(async () => {
  const created = await createdIds();
  const all = [...userIds, ...created];
  await prisma.idempotencyRecord.deleteMany({ where: { actorUserId: { in: all } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorUserId: { in: all } }, { entityId: { in: all } }] },
  });
  await prisma.userProfile.deleteMany({ where: { userId: { in: all } } });
  await prisma.session.deleteMany({ where: { userId: { in: all } } });
  await prisma.user.deleteMany({ where: { id: { in: all } } });
  await prisma.employee.deleteMany({ where: { id: employeeId } });

  expect(await globalCounts()).toEqual(baseline);
  expect(await prisma.user.count({ where: { username: { startsWith: RUN } } })).toBe(0);
  // El ADMIN real (y su perfil) no se tocó.
  expect(
    await prisma.user.findMany({
      where: { role: 'ADMIN', username: { not: { startsWith: 'test-' } } },
      select: { id: true, username: true, status: true, updatedAt: true, personalProfile: true },
    }),
  ).toEqual(realAdmins);
}, 60_000);

describe('POST /admin/users/admins — permisos y contrato', () => {
  it('sin sesión 401; EMPLOYEE 403; nada se crea', async () => {
    const body = { displayName: `Nuevo ${NAME_TAG}`, pin: '0123' };
    expect((await post(null, body)).status).toBe(401);
    expect((await post(employee, body)).status).toBe(403);
    expect(await createdIds()).toHaveLength(0);
  });

  it('body estricto: rechaza rol, ids, username, estado, pinHash y PIN inválido (en español)', async () => {
    const base = { displayName: `Nuevo ${NAME_TAG}`, pin: '0123' };
    for (const extra of [
      { role: 'EMPLOYEE' },
      { userId: admin.userId },
      { employeeId },
      { username: 'elegido' },
      { status: 'SUSPENDED' },
      { pinHash: 'x' },
    ]) {
      const response = await post(admin, { ...base, ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(400);
      expect(response.body.error.message).toBe(
        'La solicitud incluye datos que no se pueden modificar.',
      );
    }
    const badPin = await post(admin, { ...base, pin: '123' });
    expect(badPin.status).toBe(400);
    expect(badPin.body.error.message).toBe('El PIN debe tener exactamente 4 dígitos (0-9).');
    const numericPin = await post(admin, { ...base, pin: 123 });
    expect(numericPin.status).toBe(400);
    const badName = await post(admin, { ...base, displayName: 'A' });
    expect(badName.body.error.message).toBe('El nombre debe tener al menos 2 letras.');
    expect(await createdIds()).toHaveLength(0);
  });
});

describe('POST /admin/users/admins — alta real', () => {
  let createdId = '';
  const name = `Administradora ${NAME_TAG}`;

  it('crea un ADMIN activo, sin Employee, con perfil y auditoría; la respuesta no trae nada sensible', async () => {
    const usersBefore = await prisma.user.count();
    const response = await post(admin, { displayName: `  ${name}  `, pin: '0123' });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body.user).sort()).toEqual(
      ['createdAt', 'displayName', 'id', 'role', 'status'].sort(),
    );
    expect(response.body.user).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      displayName: name,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /0123|argon|admin-[0-9a-f]{16}|pinHash|token/i,
    );
    createdId = response.body.user.id;

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: createdId },
      select: {
        username: true,
        role: true,
        status: true,
        pinHash: true,
        employeeId: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        personalProfile: { select: { displayName: true, birthDate: true } },
      },
    });
    expect(row).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      employeeId: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
      personalProfile: { displayName: name, birthDate: null },
    });
    expect(row.username).toMatch(TECHNICAL_USERNAME_PATTERN);
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    expect(await prisma.user.count()).toBe(usersBefore + 1);
    expect(await prisma.employee.count({ where: { user: { id: createdId } } })).toBe(0);
    const audits = await prisma.auditLog.findMany({ where: { entityId: createdId } });
    expect(audits.map((audit) => audit.action)).toEqual(['admin.user.created']);
    expect(JSON.stringify(audits)).not.toMatch(/0123|argon2|admin-[0-9a-f]{16}/);
  });

  it('puede ingresar con su PIN (cero inicial conservado) y se ve con su nombre, nunca el username', async () => {
    const result = await login(prisma, {
      userId: createdId,
      pin: '0123',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest-integration',
    });
    expect(result.user).toMatchObject({
      id: createdId,
      role: 'ADMIN',
      displayName: name,
      employee: null,
    });
    await expect(
      login(prisma, { userId: createdId, pin: '123', ipAddress: null, userAgent: null }),
    ).rejects.toMatchObject({ statusCode: 401 });
    const options = (await request(app).get('/api/v1/auth/login-options')).body.options as {
      id: string;
      displayName: string;
      role: string;
    }[];
    expect(options.find((option) => option.id === createdId)).toMatchObject({
      displayName: name,
      role: 'ADMIN',
    });
    expect(JSON.stringify(options)).not.toMatch(/admin-[0-9a-f]{16}/);
  });

  it('el listado de Usuarios lo marca como username técnico (la UI no lo muestra)', async () => {
    const list = await request(app).get('/api/v1/admin/users?pageSize=100').set(as(admin));
    const item = (
      list.body.users as { id: string; technicalUsername: boolean; personalProfile: unknown }[]
    ).find((user) => user.id === createdId);
    expect(item).toMatchObject({ technicalUsername: true, personalProfile: { displayName: name } });
    const synthetic = (list.body.users as { id: string; technicalUsername: boolean }[]).find(
      (user) => user.id === admin.userId,
    );
    expect(synthetic?.technicalUsername).toBe(false);
  });

  it('no aparece en empleados operativos, Tareas, Desempeño ni selectores', async () => {
    const today = toLocalDate(new Date(), config.businessTimeZone);
    const from = formatLocalDate(addDays(today, -6));
    const to = formatLocalDate(today);
    for (const path of [
      '/api/v1/tasks/employees',
      '/api/v1/employees',
      '/api/v1/employees/profiles',
      `/api/v1/performance/summary?from=${from}&to=${to}`,
    ]) {
      const response = await request(app).get(path).set(as(admin));
      expect(response.status, path).toBe(200);
      expect(JSON.stringify(response.body), path).not.toContain(createdId);
      expect(JSON.stringify(response.body), path).not.toContain(name);
    }
  });

  it('doble envío con la misma Idempotency-Key crea UNA sola cuenta', async () => {
    const before = (await createdIds()).length;
    const key = crypto.randomUUID().replace(/-/g, '');
    const body = { displayName: `Segunda ${NAME_TAG}`, pin: '4071' };
    const [a, b] = await Promise.all([post(admin, body, key), post(admin, body, key)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    expect((await createdIds()).length).toBe(before + 1);
    const replay = await post(admin, body, key);
    expect(replay.status).toBe(201);
    expect(replay.body.user.id).toBe((a.status === 201 ? a : b).body.user.id);
    const stored = await prisma.idempotencyRecord.findFirstOrThrow({
      where: { actorUserId: admin.userId, key },
    });
    expect(JSON.stringify(stored)).not.toMatch(/4071|admin-[0-9a-f]{16}/);
  });
});
