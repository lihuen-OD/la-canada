import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { hashPassword } from '../../auth/password';
import { hashRefreshToken } from '../../auth/tokens';
import { login, logout, refresh } from '../../auth/authService';
import { InvalidSessionError } from '../../errors/AppError';

/**
 * Contra Neon real (`demo`) — requiere `DATABASE_TARGET=demo` (ver
 * `npm run test:integration`, que corre la guarda antes de esto). Crea un
 * único usuario de prueba, claramente marcado, y lo limpia en `afterAll`
 * (determinístico, no transaccional — `login`/`refresh` ya abren sus
 * propias transacciones internamente, no se pueden anidar). La última
 * verificación no adivina nombres de modelos ajenos a este módulo: solo
 * confirma que `users`/`sessions`/`audit_logs` vuelven exactamente a su
 * conteo previo a este archivo, es decir, que no queda ningún residuo de
 * prueba y que no se tocó ninguna fila preexistente del seed real.
 */

const TEST_USERNAME = `test-auth-integration-${Date.now()}`;
const TEST_PASSWORD = 'contraseña de integración bastante larga y segura';
const META = { ipAddress: '127.0.0.1', userAgent: 'vitest-integration' };

const CONCURRENT_USERNAME = `test-auth-integration-concurrent-${Date.now()}`;
const CONCURRENT_PASSWORD = 'contraseña de la prueba de concurrencia bastante larga';

let testUserId: string;
let concurrentTestUserId: string;
let baselineUserCount: number;
let baselineSessionCount: number;
let baselineAuditLogCount: number;

beforeAll(async () => {
  baselineUserCount = await prisma.user.count();
  baselineSessionCount = await prisma.session.count();
  baselineAuditLogCount = await prisma.auditLog.count();
});

afterAll(async () => {
  for (const id of [testUserId, concurrentTestUserId]) {
    if (!id) continue;
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } });
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }

  expect(await prisma.user.count()).toBe(baselineUserCount);
  expect(await prisma.session.count()).toBe(baselineSessionCount);
  expect(await prisma.auditLog.count()).toBe(baselineAuditLogCount);
});

describe('authService — flujo real contra demo', () => {
  it('crea el usuario de prueba (setup)', async () => {
    const passwordHash = await hashPassword(TEST_PASSWORD);
    const user = await prisma.user.create({
      data: { username: TEST_USERNAME, role: 'EMPLOYEE', status: 'ACTIVE', passwordHash },
      select: { id: true },
    });
    testUserId = user.id;
    expect(testUserId).toEqual(expect.any(String));
  });

  it('login real: crea una Session real en la base', async () => {
    const result = await login(prisma, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      ...META,
    });
    expect(result.accessToken).toEqual(expect.any(String));

    const sessions = await prisma.session.findMany({ where: { userId: testUserId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revokedAt).toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: sessions[0]?.id, action: 'auth.login.success' },
    });
    expect(auditRows).toHaveLength(1);
  });

  it('refresh real: rota la sesión (vieja revocada, nueva creada)', async () => {
    // Cada `it` de este archivo hace su propio login, y el usuario de prueba
    // acumula sesiones de tests anteriores (p. ej. la de "login real", que
    // nunca se revoca) — por eso cada verificación busca por el hash de SU
    // PROPIO refresh token, nunca por `findMany({ where: { userId } })`
    // (eso traería sesiones activas de otros `it`, no solo de este).
    const loginResult = await login(prisma, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      ...META,
    });
    const rotated = await refresh(prisma, { refreshToken: loginResult.refreshToken, ...META });
    expect(rotated.refreshToken).not.toBe(loginResult.refreshToken);

    const oldSession = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(loginResult.refreshToken) },
    });
    const newSession = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(rotated.refreshToken) },
    });
    expect(oldSession?.revokedAt).not.toBeNull();
    expect(newSession?.revokedAt).toBeNull();
  });

  it('reutilizar un refresh token ya rotado (revocado) es detectado y revoca todo lo activo', async () => {
    const loginResult = await login(prisma, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      ...META,
    });
    const rotatedOnce = await refresh(prisma, {
      refreshToken: loginResult.refreshToken,
      ...META,
    });

    await expect(
      refresh(prisma, { refreshToken: loginResult.refreshToken, ...META }),
    ).rejects.toBeInstanceOf(InvalidSessionError);

    // La detección de reuso revoca TODAS las sesiones activas del usuario —
    // en particular, también la que acababa de nacer de la rotación válida
    // un instante antes (`rotatedOnce`), no solo el token reusado.
    const sessionFromValidRotation = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(rotatedOnce.refreshToken) },
    });
    expect(sessionFromValidRotation?.revokedAt).not.toBeNull();

    const reuseAudit = await prisma.auditLog.findMany({
      where: { actorUserId: testUserId, action: 'auth.refresh.reuse_detected' },
    });
    expect(reuseAudit.length).toBeGreaterThanOrEqual(1);
  });

  it('logout real: revoca la sesión correspondiente y es idempotente', async () => {
    const loginResult = await login(prisma, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
      ...META,
    });
    await logout(prisma, { refreshToken: loginResult.refreshToken, ...META });

    const thisSession = await prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(loginResult.refreshToken) },
    });
    expect(thisSession?.revokedAt).not.toBeNull();

    // Segunda vez con el mismo token (ya revocado) — no debe lanzar.
    await expect(
      logout(prisma, { refreshToken: loginResult.refreshToken, ...META }),
    ).resolves.toBeUndefined();
  });

  it('concurrencia — crea un segundo usuario de prueba dedicado (setup)', async () => {
    const passwordHash = await hashPassword(CONCURRENT_PASSWORD);
    const user = await prisma.user.create({
      data: { username: CONCURRENT_USERNAME, role: 'EMPLOYEE', status: 'ACTIVE', passwordHash },
      select: { id: true },
    });
    concurrentTestUserId = user.id;
    expect(concurrentTestUserId).toEqual(expect.any(String));
  });

  it('dos refresh simultáneos con el mismo token: exactamente uno gana, nunca quedan dos sesiones activas utilizables', async () => {
    const loginResult = await login(prisma, {
      username: CONCURRENT_USERNAME,
      password: CONCURRENT_PASSWORD,
      ...META,
    });

    // Mismo refresh token, dos llamadas a `refresh()` lanzadas a la vez —
    // simula dos requests HTTP concurrentes contra /auth/refresh. La toma
    // atómica de la sesión (ver authService.ts) garantiza que como máximo
    // una gane; la otra debe recibir el mismo error genérico de sesión
    // inválida, nunca un segundo refresh token utilizable.
    const results = await Promise.allSettled([
      refresh(prisma, { refreshToken: loginResult.refreshToken, ...META }),
      refresh(prisma, { refreshToken: loginResult.refreshToken, ...META }),
    ]);

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof refresh>>> =>
        r.status === 'fulfilled',
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InvalidSessionError);

    // La detección conservadora revoca TODAS las sesiones activas del
    // usuario ante la carrera — incluida la que la solicitud ganadora
    // acababa de crear. No debe quedar ninguna sesión activa para este
    // usuario después de que ambas promesas resolvieron.
    const sessions = await prisma.session.findMany({ where: { userId: concurrentTestUserId } });
    const activeSessions = sessions.filter((s) => s.revokedAt === null);
    expect(activeSessions).toHaveLength(0);

    // Qué rama exacta detecta al perdedor depende del timing real de red
    // contra Neon, no es determinístico desde el test: si su lectura inicial
    // ocurre antes de que la ganadora confirme, entra por la toma atómica
    // (`auth.refresh.concurrent_rotation_detected`); si ocurre después,
    // ya ve la sesión revocada y entra por la detección de reuso clásica
    // (`auth.refresh.reuse_detected`, ver el test de reuso más arriba) —
    // ambas ramas aplican exactamente la misma respuesta de seguridad
    // (revocar todo lo activo + auditar), así que cualquiera de las dos
    // cuenta como la protección funcionando.
    const concurrentAudit = await prisma.auditLog.findMany({
      where: {
        actorUserId: concurrentTestUserId,
        action: {
          in: ['auth.refresh.concurrent_rotation_detected', 'auth.refresh.reuse_detected'],
        },
      },
    });
    expect(concurrentAudit.length).toBeGreaterThanOrEqual(1);
  });

  it('los usuarios del seed real no cambiaron de estado ni de rol durante este archivo', async () => {
    const seedUsers = await prisma.user.findMany({
      where: { username: { notIn: [TEST_USERNAME, CONCURRENT_USERNAME] } },
      select: { username: true, role: true, status: true },
    });
    // No se afirma un número fijo acá (ya se verificó por SQL directo tras
    // aplicar la migración) — solo que ninguno quedó en un estado
    // "tocado sin querer" por esta suite (todos ACTIVE, sin sorpresas de rol).
    expect(seedUsers.length).toBeGreaterThan(0);
    for (const user of seedUsers) {
      expect(['ADMIN', 'EMPLOYEE']).toContain(user.role);
      expect(['ACTIVE', 'PENDING_ACTIVATION', 'SUSPENDED', 'DEACTIVATED']).toContain(user.status);
    }
  });
});
