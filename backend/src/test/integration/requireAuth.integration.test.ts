import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import pg from 'pg';
import { accessTokenSecret } from '../../auth/config';
// `vi.mock` se hoistea por encima de estos imports: reciben el cliente contado.
import { prisma } from '../../lib/prisma';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { errorHandler } from '../../middleware/errorHandler';
import { createApp } from '../../app';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';

/**
 * Etapa 5P — `requireAuth` optimizado (sesión + usuario + empleado en UNA
 * operación) contra Neon real (`demo`). Solo fixtures sintéticas
 * `test-5p-auth-<RUN>`; nunca usa ni modifica usuarios o sesiones reales.
 *
 * Demostración de "una sola consulta", con dos contadores independientes y
 * locales a este archivo (nada se agrega al código de producción):
 *  1. operaciones Prisma, vía `$extends` sobre el cliente real;
 *  2. sentencias SQL que llegan a Postgres, instrumentando
 *     `pg.Client.prototype.query` (el mismo `pg` que usa `@prisma/adapter-pg`).
 *     Solo se registra el tipo de sentencia y las tablas — nunca parámetros,
 *     tokens ni valores.
 */

const probe = vi.hoisted(() => ({ active: false, prismaOps: [] as string[] }));

vi.mock('../../lib/prisma', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/prisma')>();
  const counted = actual.prisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        if (probe.active) probe.prismaOps.push(`${model ?? 'raw'}.${operation}`);
        return query(args);
      },
    },
  });
  return { ...actual, prisma: counted };
});

type QueryFn = (...args: unknown[]) => unknown;
const sqlStatements: string[] = [];
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;

/** Resumen NO sensible de una sentencia: verbo + tablas, sin valores. */
function summarize(arg: unknown): string {
  const text = typeof arg === 'string' ? arg : ((arg as { text?: string })?.text ?? '');
  const verb = text.trim().split(/\s+/)[0]?.toUpperCase() ?? '?';
  const tables = [...text.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+"?(?:public"?\."?)?"?(\w+)"?/gi)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index);
  return `${verb} ${tables.join(',')}`;
}

async function measure<T>(run: () => Promise<T>): Promise<T> {
  probe.prismaOps.length = 0;
  sqlStatements.length = 0;
  probe.active = true;
  try {
    return await run();
  } finally {
    probe.active = false;
  }
}

const RUN = `test-5p-auth-${Date.now()}`;
const userIds: string[] = [];
const employeeIds: string[] = [];
let baseline: { users: number; sessions: number; employees: number; audits: number };
let probeApp: Express;
let app: Express;

interface Fixture {
  userId: string;
  sessionId: string;
  token: string;
}

async function createUser(
  suffix: string,
  role: 'ADMIN' | 'EMPLOYEE',
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  employeeId?: string,
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status,
      // Sintético y no verificable: estos usuarios nunca hacen login por PIN.
      pinHash: 'synthetic-not-a-real-hash',
      employeeId,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function createSession(
  userId: string,
  options: { revoked?: boolean; expired?: boolean } = {},
): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + (options.expired ? -60_000 : 60 * 60 * 1000)),
      revokedAt: options.revoked ? new Date() : null,
    },
    select: { id: true },
  });
  return session.id;
}

async function fixture(
  userId: string,
  jwtRole: 'ADMIN' | 'EMPLOYEE',
  sessionOptions: { revoked?: boolean; expired?: boolean } = {},
): Promise<Fixture> {
  const sessionId = await createSession(userId, sessionOptions);
  const token = await signAccessToken({ userId, sessionId, role: jwtRole }, accessTokenSecret, 600);
  return { userId, sessionId, token };
}

let employee: Fixture;
let employeeWithAdminClaim: Fixture;
let admin: Fixture;
let revoked: Fixture;
let expired: Fixture;
let suspended: Fixture;
let mismatchToken: string;
let employeeId = '';

beforeAll(async () => {
  baseline = {
    users: await prisma.user.count(),
    sessions: await prisma.session.count(),
    employees: await prisma.employee.count(),
    audits: await prisma.auditLog.count(),
  };

  // Rutas de prueba montadas con los middlewares REALES (sin tocar datos reales).
  probeApp = express();
  probeApp.get('/probe', requireAuth, (req: Request, res: Response) => {
    res.json({ auth: req.auth });
  });
  probeApp.get('/admin-probe', requireAuth, requireRole('ADMIN'), (req: Request, res: Response) => {
    res.json({ ok: true, role: req.auth?.role });
  });
  probeApp.use(errorHandler);
  app = createApp();

  const createdEmployee = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Sintético ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeId = createdEmployee.id;
  employeeIds.push(employeeId);

  const employeeUser = await createUser('employee', 'EMPLOYEE', 'ACTIVE', employeeId);
  const adminUser = await createUser('admin', 'ADMIN');
  const otherUser = await createUser('other', 'EMPLOYEE');
  const suspendedUser = await createUser('suspended', 'EMPLOYEE', 'SUSPENDED');

  employee = await fixture(employeeUser, 'EMPLOYEE');
  // JWT que "dice" ADMIN para un EMPLOYEE: el rol debe salir de la base.
  employeeWithAdminClaim = await fixture(employeeUser, 'ADMIN');
  admin = await fixture(adminUser, 'ADMIN');
  revoked = await fixture(employeeUser, 'EMPLOYEE', { revoked: true });
  expired = await fixture(employeeUser, 'EMPLOYEE', { expired: true });
  suspended = await fixture(suspendedUser, 'EMPLOYEE');
  // `sub` = employeeUser, pero `sid` = una sesión válida de OTRO usuario.
  const otherSession = await createSession(otherUser);
  mismatchToken = await signAccessToken(
    { userId: employeeUser, sessionId: otherSession, role: 'EMPLOYEE' },
    accessTokenSecret,
    600,
  );

  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (probe.active) sqlStatements.push(summarize(args[0]));
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  probe.active = false;
  // Solo lo creado por esta corrida, por id; orden compatible con las FK.
  const sessionIds = (
    await prisma.session.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
  ).map((session: { id: string }) => session.id);
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...userIds, ...sessionIds, ...employeeIds] } },
      ],
    },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  expect(await prisma.user.count()).toBe(baseline.users);
  expect(await prisma.session.count()).toBe(baseline.sessions);
  expect(await prisma.employee.count()).toBe(baseline.employees);
  expect(await prisma.auditLog.count()).toBe(baseline.audits);
  expect(await prisma.user.count({ where: { username: { startsWith: 'test-5p-auth-' } } })).toBe(0);
  expect(await prisma.employee.count({ where: { code: { startsWith: 'test-5p-auth-' } } })).toBe(0);
}, 60_000);

beforeEach(() => {
  probe.active = false;
});

const AUTH_REQUIRED = {
  error: { message: 'Autenticación requerida.', code: 'AUTH_REQUIRED' },
};
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('requireAuth contra Postgres real — sesión válida', () => {
  it('construye req.auth desde la base (rol y empleado activo) con UNA sola consulta', async () => {
    const response = await measure(() =>
      request(probeApp).get('/probe').set(bearer(employee.token)),
    );
    expect(response.status).toBe(200);
    expect(response.body.auth).toEqual({
      userId: employee.userId,
      sessionId: employee.sessionId,
      role: 'EMPLOYEE',
      employeeId,
    });
    // Evidencia (sin valores): operaciones Prisma y sentencias SQL reales.
    // eslint-disable-next-line no-console -- solo nombres de operación/tabla
    console.info(
      `[5p-auth] prisma=${JSON.stringify(probe.prismaOps)} sql=${JSON.stringify(sqlStatements)}`,
    );
    expect(probe.prismaOps).toHaveLength(1);
    // Todas las sentencias que llegaron a Postgres: exactamente UNA, que
    // resuelve sesión, usuario y empleado juntos (antes eran 2–4).
    const dataStatements = sqlStatements.filter((statement) => !/^(BEGIN|COMMIT)/.test(statement));
    expect(dataStatements).toHaveLength(1);
    expect(dataStatements[0]).toMatch(/sessions/);
    expect(dataStatements[0]).toMatch(/users/);
    expect(dataStatements[0]).toMatch(/employees/);
  });

  it('el rol sale de la base, nunca del claim del JWT', async () => {
    const response = await request(probeApp)
      .get('/probe')
      .set(bearer(employeeWithAdminClaim.token));
    expect(response.status).toBe(200);
    expect(response.body.auth.role).toBe('EMPLOYEE');
    const adminAttempt = await request(probeApp)
      .get('/admin-probe')
      .set(bearer(employeeWithAdminClaim.token));
    expect(adminAttempt.status).toBe(403);
    expect(adminAttempt.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('endpoint protegido real (/auth/me) responde con el usuario de la sesión', async () => {
    const response = await request(app).get('/api/v1/auth/me').set(bearer(employee.token));
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: employee.userId,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/pinHash|refreshToken|username/);
  });
});

describe('requireAuth contra Postgres real — rechazos genéricos (401 AUTH_REQUIRED)', () => {
  it.each([
    ['sesión revocada', () => revoked.token],
    ['sesión vencida', () => expired.token],
    ['usuario SUSPENDED con sesión estructuralmente válida', () => suspended.token],
    ['sub de un usuario con sid de la sesión de otro', () => mismatchToken],
  ])('%s', async (_label, token) => {
    const response = await measure(() => request(probeApp).get('/probe').set(bearer(token())));
    expect(response.status).toBe(401);
    expect(response.body).toEqual(AUTH_REQUIRED);
    // Nunca se asignó autenticación ni se filtró estado interno.
    expect(response.body.auth).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toMatch(/revoked|expired|SUSPENDED|session|prisma/i);
    // También el rechazo cuesta una sola operación y una sola sentencia.
    expect(probe.prismaOps).toHaveLength(1);
    expect(sqlStatements).toHaveLength(1);
  });

  it('el endpoint real también rechaza una sesión revocada', async () => {
    const response = await request(app).get('/api/v1/auth/me').set(bearer(revoked.token));
    expect(response.status).toBe(401);
    expect(response.body).toEqual(AUTH_REQUIRED);
  });
});

describe('autorización por rol con los middlewares reales', () => {
  it('ADMIN activo accede a la ruta administrativa', async () => {
    const response = await request(probeApp).get('/admin-probe').set(bearer(admin.token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, role: 'ADMIN' });
  });

  it('EMPLOYEE activo accede a lo protegido normal, pero no a lo administrativo', async () => {
    expect((await request(probeApp).get('/probe').set(bearer(employee.token))).status).toBe(200);
    const denied = await request(probeApp).get('/admin-probe').set(bearer(employee.token));
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
    // Ruta administrativa REAL: rechazada antes de leer ningún dato.
    const realAdmin = await request(app).get('/api/v1/admin/users').set(bearer(employee.token));
    expect(realAdmin.status).toBe(403);
    expect(realAdmin.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});
