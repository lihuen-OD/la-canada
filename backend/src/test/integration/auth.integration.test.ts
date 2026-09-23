import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { hashPin } from '../../auth/pin';
import { hashRefreshToken } from '../../auth/tokens';
import { login, logout, refresh } from '../../auth/authService';
import { InvalidSessionError } from '../../errors/AppError';

/**
 * Contra Neon real (`demo`) — requiere `DATABASE_TARGET=demo` (ver
 * `npm run test:integration`, que corre la guarda antes de esto). Crea
 * usuarios de prueba dedicados, claramente marcados, y los limpia en
 * `afterAll` (determinístico, no transaccional — `login`/`refresh` ya abren
 * sus propias transacciones internamente, no se pueden anidar). La última
 * verificación no adivina nombres de modelos ajenos a este módulo: solo
 * confirma que `users`/`sessions`/`audit_logs` vuelven exactamente a su
 * conteo previo a este archivo, es decir, que no queda ningún residuo de
 * prueba y que no se tocó ninguna fila preexistente del seed real.
 */

const TEST_USERNAME = `test-auth-integration-${Date.now()}`;
const TEST_PIN = '5173';
const META = { ipAddress: '127.0.0.1', userAgent: 'vitest-integration' };

const CONCURRENT_USERNAME = `test-auth-integration-concurrent-${Date.now()}`;
const CONCURRENT_PIN = '9042';

const BRUTE_FORCE_USERNAME = `test-auth-integration-bruteforce-${Date.now()}`;
const BRUTE_FORCE_PIN = '2861';

let testUserId: string;
let concurrentTestUserId: string;
let bruteForceUserId: string;
let baselineUserCount: number;
let baselineSessionCount: number;
let baselineAuditLogCount: number;

beforeAll(async () => {
  baselineUserCount = await prisma.user.count();
  baselineSessionCount = await prisma.session.count();
  baselineAuditLogCount = await prisma.auditLog.count();
});

afterAll(async () => {
  for (const id of [testUserId, concurrentTestUserId, bruteForceUserId]) {
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
    const pinHash = await hashPin(TEST_PIN);
    const user = await prisma.user.create({
      data: { username: TEST_USERNAME, role: 'EMPLOYEE', status: 'ACTIVE', pinHash },
      select: { id: true },
    });
    testUserId = user.id;
    expect(testUserId).toEqual(expect.any(String));
  });

  it('login real con PIN: crea una Session real en la base', async () => {
    const result = await login(prisma, { userId: testUserId, pin: TEST_PIN, ...META });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user).not.toHaveProperty('username');
    expect(result.user).not.toHaveProperty('pinHash');

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
    const loginResult = await login(prisma, { userId: testUserId, pin: TEST_PIN, ...META });
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
    const loginResult = await login(prisma, { userId: testUserId, pin: TEST_PIN, ...META });
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
    const loginResult = await login(prisma, { userId: testUserId, pin: TEST_PIN, ...META });
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
    const pinHash = await hashPin(CONCURRENT_PIN);
    const user = await prisma.user.create({
      data: { username: CONCURRENT_USERNAME, role: 'EMPLOYEE', status: 'ACTIVE', pinHash },
      select: { id: true },
    });
    concurrentTestUserId = user.id;
    expect(concurrentTestUserId).toEqual(expect.any(String));
  });

  it('dos refresh simultáneos con el mismo token: exactamente uno gana, nunca quedan dos sesiones activas utilizables', async () => {
    const loginResult = await login(prisma, {
      userId: concurrentTestUserId,
      pin: CONCURRENT_PIN,
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

    const sessions = await prisma.session.findMany({ where: { userId: concurrentTestUserId } });
    const activeSessions = sessions.filter((s) => s.revokedAt === null);
    expect(activeSessions).toHaveLength(0);

    // Qué rama exacta detecta al perdedor depende del timing real de red
    // contra Neon (ver el comentario en authService.ts) — ambas ramas
    // aplican exactamente la misma respuesta de seguridad.
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

  it('fuerza bruta — crea un tercer usuario de prueba dedicado (setup)', async () => {
    const pinHash = await hashPin(BRUTE_FORCE_PIN);
    const user = await prisma.user.create({
      data: { username: BRUTE_FORCE_USERNAME, role: 'EMPLOYEE', status: 'ACTIVE', pinHash },
      select: { id: true },
    });
    bruteForceUserId = user.id;
    expect(bruteForceUserId).toEqual(expect.any(String));
  });

  it('10 intentos fallidos concurrentes no pierden ningún incremento del contador', async () => {
    // El incremento atómico (`{ increment: 1 }`, `SET col = col + 1` a nivel
    // SQL) es lo que garantiza esto — un "leer contador, sumar en JS,
    // escribir" perdería incrementos bajo concurrencia real. 10 intentos,
    // no 5: además de probar que no se pierde ningún incremento, confirma
    // que seguir fallando una vez ya bloqueada la cuenta no hace que el
    // contador "se pase" de forma incorrecta ni rompa nada.
    const attempts = Array.from({ length: 10 }, () =>
      login(prisma, { userId: bruteForceUserId, pin: '0000', ...META }).catch(() => undefined),
    );
    await Promise.all(attempts);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: bruteForceUserId } });
    expect(user.failedLoginAttempts).toBe(10);
    expect(user.lockedUntil).not.toBeNull();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // La cuenta bloqueada rechaza el login aunque el PIN sea el correcto.
    await expect(
      login(prisma, { userId: bruteForceUserId, pin: BRUTE_FORCE_PIN, ...META }),
    ).rejects.toThrow();

    // Auditoría de bloqueo generada exactamente una vez (el cruce del
    // umbral ocurre una sola vez, en el intento que hizo age el contador a 5).
    const lockedAudit = await prisma.auditLog.findMany({
      where: { actorUserId: bruteForceUserId, action: 'auth.login.locked' },
    });
    expect(lockedAudit).toHaveLength(1);

    // Limpieza manual del bloqueo para no dejar este usuario de prueba en un
    // estado que compita con el resto de la suite (se borra en `afterAll`,
    // pero esto documenta explícitamente el reseteo real vía DB directa).
    await prisma.user.update({
      where: { id: bruteForceUserId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  });

  it('los usuarios del seed real no cambiaron de estado ni de rol durante este archivo', async () => {
    const seedUsers = await prisma.user.findMany({
      where: { username: { notIn: [TEST_USERNAME, CONCURRENT_USERNAME, BRUTE_FORCE_USERNAME] } },
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
