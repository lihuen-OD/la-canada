import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
  InvalidCredentialsError,
  InvalidSessionError,
  SessionRefreshUnavailableError,
} from '../errors/AppError';
import { verifyAgainstDummy, verifyPin } from './pin';
import {
  deriveSuccessorRefreshToken,
  generateRefreshAttemptId,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  type AccessTokenClaims,
} from './tokens';
import {
  accessTokenSecret,
  accessTokenTtlSeconds,
  refreshRotationKey,
  refreshTokenTtlSeconds,
} from './config';
import { recordAuditLog, recordAuditLogSafe } from './auditLog';

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Nunca incluye `username` (Etapa 3B.2: es un identificador técnico interno,
 * no algo que se muestre a la propia persona autenticada) ni, por supuesto,
 * `pinHash`, intentos fallidos o fecha de bloqueo.
 */
export interface PublicUser {
  id: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: string;
  /**
   * Etapa 5F — nombre visible cargado: el del `Employee` vinculado o, si no
   * tiene, el de `UserProfile` (ADMIN). `null` = todavía sin nombre (el
   * frontend muestra "Administrador"). Nunca el `username`.
   */
  displayName: string | null;
  employee: { id: string; displayName: string; colorHex: string } | null;
}

export interface LoginResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
  user: PublicUser;
}

/**
 * Etiqueta genérica para un `ADMIN` sin `Employee` vinculado ni nombre cargado
 * en Mi perfil — nunca se usa `username` como reemplazo, aunque estuviera
 * disponible, porque es un identificador técnico interno, no un nombre
 * pensado para mostrarse.
 */
const ADMIN_FALLBACK_DISPLAY_NAME = 'Administrador';

type NamedUser = {
  employee?: { displayName: string } | null;
  personalProfile?: { displayName: string | null } | null;
};

/** Nombre visible cargado (Employee → perfil personal) o null. Nunca `username`. */
export const loadedVisibleName = (user: NamedUser): string | null =>
  user.employee?.displayName ?? user.personalProfile?.displayName ?? null;

/** Nombre visible con el fallback "Administrador" (selector de ingreso). */
export const resolveVisibleName = (user: NamedUser): string =>
  loadedVisibleName(user) ?? ADMIN_FALLBACK_DISPLAY_NAME;

function toPublicUser(user: {
  id: string;
  role: 'ADMIN' | 'EMPLOYEE';
  status: string;
  employee: { id: string; displayName: string; colorHex: string } | null;
  personalProfile?: { displayName: string | null } | null;
}): PublicUser {
  const { employee } = user;
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    displayName: loadedVisibleName(user),
    // Campos explícitos: `active` (y cualquier otro) nunca se filtra al cliente.
    employee: employee
      ? { id: employee.id, displayName: employee.displayName, colorHex: employee.colorHex }
      : null,
  };
}

/**
 * Etapa 5X — paridad con el prototipo: una persona dada de baja en
 * Configuración no aparece en el selector ni puede ingresar
 * (`selRol('user')` solo listaba personas activas).
 */
function isEmployeeDeactivated(user: {
  role: string;
  employee: { active?: boolean } | null;
}): boolean {
  return user.role === 'EMPLOYEE' && user.employee?.active === false;
}

const USER_SELECT_FOR_AUTH = {
  id: true,
  role: true,
  status: true,
  pinHash: true,
  failedLoginAttempts: true,
  lockedUntil: true,
  employee: { select: { id: true, displayName: true, colorHex: true, active: true } },
  personalProfile: { select: { displayName: true } },
} as const;

/**
 * Protección persistente contra fuerza bruta sobre el PIN (10.000
 * combinaciones posibles) — ver `docs/SECURITY.md`, "Autenticación por PIN".
 * Valores fijos, no configurables por entorno: la política de bloqueo es
 * una decisión de producto, no un parámetro de despliegue.
 */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function isLocked(user: { lockedUntil: Date | null }): boolean {
  return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
}

async function issueSession(
  prisma: PrismaClient,
  params: { userId: string; role: 'ADMIN' | 'EMPLOYEE' } & RequestMeta,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.create({
    data: {
      userId: params.userId,
      refreshTokenHash,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
    },
    select: { id: true },
  });

  const claims: AccessTokenClaims = {
    userId: params.userId,
    sessionId: session.id,
    role: params.role,
  };
  const accessToken = await signAccessToken(claims, accessTokenSecret, accessTokenTtlSeconds);

  return { accessToken, refreshToken, sessionId: session.id };
}

/**
 * Login — identidad seleccionada (`userId`) + PIN de 4 dígitos (Etapa
 * 3B.2, reemplaza username+contraseña). Sin distinguir en la respuesta
 * usuario inexistente, PIN incorrecto, estado no ACTIVE, o cuenta
 * bloqueada por intentos fallidos: siempre `InvalidCredentialsError` (evita
 * enumeración de cuentas y de motivos de bloqueo). Cuando el usuario no
 * existe, no tiene `pinHash` todavía, o está bloqueado, se verifica igual
 * contra un hash dummy para no delatar la diferencia por tiempo de
 * respuesta entre esos casos y un PIN real incorrecto.
 */
export async function login(
  prisma: PrismaClient,
  params: { userId: string; pin: string } & RequestMeta,
): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: USER_SELECT_FOR_AUTH,
  });

  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !user.pinHash ||
    isLocked(user) ||
    isEmployeeDeactivated(user)
  ) {
    await verifyAgainstDummy(params.pin);
    await recordAuditLogSafe(prisma, {
      actorUserId: user?.id ?? null,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user?.id ?? params.userId,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    throw new InvalidCredentialsError();
  }

  const pinValid = await verifyPin(user.pinHash, params.pin);
  if (!pinValid) {
    // Incremento atómico (`SET col = col + 1` a nivel SQL, vía el operador
    // `increment` de Prisma) — nunca "leer contador, sumar en JS, escribir
    // contador+1", que perdería incrementos bajo intentos concurrentes.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    // Toma atómica del bloqueo: bajo una ráfaga concurrente, varias
    // solicitudes pueden cruzar el umbral con su propio incremento (el
    // conteo en sí nunca se pierde, pero *cuál* de ellas "aplica" el
    // bloqueo sí puede duplicarse si no se condiciona la escritura). Igual
    // que la toma atómica de sesión en `refresh()`: el `updateMany` exige
    // que `lockedUntil` esté nulo o ya vencido *en el momento de escribir*
    // — Postgres solo dejar pasar la escritura de la primera solicitud que
    // llega a ese estado; el resto, al desbloquearse, reevalúa el `WHERE`
    // contra la fila ya bloqueada por la primera y no matchea (`count: 0`).
    // Así, sin importar cuántas solicitudes concurrentes crucen el umbral,
    // como máximo una queda marcada como `justLocked` y solo esa audita el
    // evento de bloqueo.
    let justLocked = false;
    if (updated.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      const lockClaim = await prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
        },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      justLocked = lockClaim.count === 1;
    }

    await recordAuditLogSafe(prisma, {
      actorUserId: user.id,
      action: 'auth.login.failed',
      entityType: 'User',
      entityId: user.id,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    if (justLocked) {
      await recordAuditLogSafe(prisma, {
        actorUserId: user.id,
        action: 'auth.login.locked',
        entityType: 'User',
        entityId: user.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
    }
    throw new InvalidCredentialsError();
  }

  // Login correcto: resetea el contador y cualquier bloqueo vigente (nunca
  // se resetean solos por el paso del tiempo — ver el campo en schema.prisma).
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  const { accessToken, refreshToken, sessionId } = await issueSession(prisma, {
    userId: user.id,
    role: user.role,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  await recordAuditLogSafe(prisma, {
    actorUserId: user.id,
    action: 'auth.login.success',
    entityType: 'Session',
    entityId: sessionId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    accessToken,
    accessTokenExpiresInSeconds: accessTokenTtlSeconds,
    refreshToken,
    refreshTokenTtlSeconds,
    user: toPublicUser(user),
  };
}

/** Identidad mínima para el selector público de login — ver `docs/ARCHITECTURE.md`, "Autenticación por PIN". */
export interface LoginOption {
  id: string;
  displayName: string;
  role: 'ADMIN' | 'EMPLOYEE';
  colorHex: string | null;
}

/**
 * Únicamente usuarios `status: ACTIVE` — los `PENDING_ACTIVATION` todavía no
 * tienen PIN (no pueden autenticarse), y `SUSPENDED`/`DEACTIVATED` no deben
 * ofrecerse como identidad seleccionable aunque conserven su PIN antiguo.
 * Nunca selecciona `pinHash`, `username`, intentos fallidos ni fecha de
 * bloqueo — ver la lista explícita de campos exportados en `LoginOption`.
 * Orden estable: por `createdAt` ascendente, igual que `GET /admin/users`.
 */
export async function getLoginOptions(prisma: PrismaClient): Promise<LoginOption[]> {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      role: true,
      employee: { select: { displayName: true, colorHex: true, active: true } },
      personalProfile: { select: { displayName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const options: LoginOption[] = [];
  for (const user of users) {
    if (isEmployeeDeactivated(user)) continue;
    if (user.role === 'EMPLOYEE' && !user.employee) {
      // Invariante de negocio: todo User EMPLOYEE debería estar vinculado a
      // un Employee real (así los siembra el seed). Si no lo estuviera, no
      // hay ningún nombre real para mostrar — se excluye del selector en vez
      // de inventar un nombre o exponer el username interno.
      continue;
    }
    options.push({
      id: user.id,
      displayName: resolveVisibleName(user),
      role: user.role,
      colorHex: user.employee?.colorHex ?? null,
    });
  }
  return options;
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenTtlSeconds: number;
}

type RotationOutcome =
  | { kind: 'invalid' }
  | {
      /** `replayed`: reenvío idempotente de una rotación ya hecha por el mismo intento. */
      kind: 'rotated' | 'replayed';
      accessToken: string;
      refreshToken: string;
      previousSessionId: string;
      newSessionId: string;
      userId: string;
    };

/**
 * Etapa 5R — hasta cuándo un intento puede reproducir la sucesora que ya
 * generó. Cubre una respuesta perdida seguida de un reintento, una recarga o
 * reabrir la pestaña al día siguiente. Pasado este plazo, la sucesora intacta
 * se revoca (queda huérfana) y se responde 401 — nunca se revocan las
 * sesiones de otros dispositivos por esto.
 */
export const REFRESH_REPLAY_WINDOW_SECONDS = 24 * 60 * 60;

/** Lo que un pedido de refresh presenta: el token viejo y la sucesora que le corresponde a su intento. */
interface RotationRequest {
  tokenHash: string;
  successorToken: string;
  successorHash: string;
}

type SessionRow = { id: string; userId: string };

/** Revoca todas las sesiones activas de un usuario y audita el motivo — usado tanto ante reuso clásico como ante una carrera de rotación concurrente detectada. */
async function revokeAllActiveSessionsAndAudit(
  tx: Prisma.TransactionClient,
  params: {
    userId: string;
    action: string;
    relatedSessionId: string;
  } & RequestMeta,
): Promise<void> {
  await tx.session.updateMany({
    where: { userId: params.userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAuditLog(tx, {
    actorUserId: params.userId,
    action: params.action,
    entityType: 'Session',
    entityId: params.relatedSessionId,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

/**
 * Etapa 5R — ¿este mismo intento ya rotó `session`? Si la sucesora derivada
 * de (token presentado, intento) existe, es del mismo usuario y sigue
 * INTACTA (nunca se usó para rotar: `revokedAt` nulo), la rotación ya se hizo
 * y solo se perdió la respuesta: se devuelve la MISMA sucesora con un access
 * token nuevo, sin crear otra sesión.
 *
 * No es una ventana de gracia: un token rotado presentado con otro intento
 * (o sin intento) nunca coincide y sigue siendo reuso; una sucesora ya usada
 * tampoco coincide (quien la recibió ya rotó); y fuera de
 * `REFRESH_REPLAY_WINDOW_SECONDS` la sucesora huérfana se revoca. Si un
 * tercero reproduce el intento, obtiene la misma sucesora que el cliente
 * legítimo: el primero que la rote deja al otro con un token revocado y la
 * detección de reuso actúa como siempre.
 *
 * `null` = no hay rotación previa de este intento: quien llama decide (reuso).
 */
async function replayPristineSuccessor(
  db: Prisma.TransactionClient,
  session: SessionRow,
  request: RotationRequest,
  params: RequestMeta,
): Promise<RotationOutcome | null> {
  const successor = await db.session.findUnique({
    where: { refreshTokenHash: request.successorHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true, createdAt: true },
  });
  const now = Date.now();
  if (
    !successor ||
    successor.userId !== session.userId ||
    successor.revokedAt !== null ||
    successor.expiresAt.getTime() <= now
  ) {
    return null;
  }
  if (now - successor.createdAt.getTime() > REFRESH_REPLAY_WINDOW_SECONDS * 1000) {
    await db.session.updateMany({
      where: { id: successor.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditLog(db, {
      actorUserId: session.userId,
      action: 'auth.refresh.replay_expired',
      entityType: 'Session',
      entityId: successor.id,
      previousState: { sessionId: session.id },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    return { kind: 'invalid' };
  }
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') return { kind: 'invalid' };
  const accessToken = await signAccessToken(
    { userId: user.id, sessionId: successor.id, role: user.role },
    accessTokenSecret,
    accessTokenTtlSeconds,
  );
  return {
    kind: 'replayed',
    accessToken,
    refreshToken: request.successorToken,
    previousSessionId: session.id,
    newSessionId: successor.id,
    userId: user.id,
  };
}

/**
 * Rotación transaccional: revocar la sesión vieja y crear la nueva deben
 * confirmarse juntas o ninguna. Ningún camino lanza dentro del callback de
 * `$transaction` — Prisma revierte TODA la transacción ante cualquier
 * excepción del callback, y la detección de reuso necesita que su efecto de
 * seguridad (revocar todas las sesiones activas + auditar) quede
 * confirmado aunque el resultado final para quien llama sea un error. Por
 * eso el callback siempre `return`a un resultado discriminado, y recién
 * después de que la transacción confirma se decide si corresponde lanzar
 * `InvalidSessionError`. La auditoría del caso normal (rotación exitosa)
 * queda deliberadamente FUERA de esa transacción (best-effort, vía
 * `recordAuditLogSafe`, después de confirmar) — un problema al auditar no
 * debe deshacer una rotación válida. La detección de reuso audita DENTRO
 * de la transacción (con `recordAuditLog` estricto): ahí el registro es
 * parte del efecto de seguridad, no un best-effort secundario.
 *
 * **Rotación concurrente**: el `findUnique` inicial NO alcanza para decidir
 * con seguridad que esta solicitud puede rotar la sesión — dos solicitudes
 * con el mismo refresh token pueden leerla ambas como "activa" antes de que
 * cualquiera escriba. La revocación de la sesión vieja se hace entonces con
 * un `updateMany` condicionado por `id` + `revokedAt: null` + vigencia
 * (`expiresAt` futuro) — no con un `update` incondicional. Bajo el nivel de
 * aislamiento por defecto de Postgres (READ COMMITTED) esto ya alcanza para
 * la exclusión mutua real: un `UPDATE` toma un lock de fila al ejecutarse, y
 * si dos transacciones intentan actualizar la misma fila, la segunda queda
 * bloqueada hasta que la primera confirme — al desbloquearse, Postgres
 * vuelve a evaluar el `WHERE` contra la fila ya committeada por la primera,
 * así que la segunda ve `revoked_at` ya no nulo y su `updateMany` afecta 0
 * filas. Si `count !== 1`: si la ganadora fue el MISMO intento (una recarga
 * mientras el primer pedido seguía en vuelo), su sucesora ya está confirmada
 * y visible para esta sentencia nueva, y se reenvía (Etapa 5R). Si no, se
 * trata igual que un reuso (no se sabe si fue una carrera benigna o un robo
 * real corriendo en paralelo a la rotación legítima): no se emite un refresh
 * token nuevo, se revocan conservadoramente todas las sesiones activas del
 * usuario (incluida la que la solicitud ganadora acababa de crear, si ya
 * llegó a confirmar), se audita, y se responde con el mismo error genérico.
 *
 * **Respuesta perdida (Etapa 5R)**: la sucesora se deriva del token
 * presentado y del intento del cliente (`deriveSuccessorRefreshToken`). Un
 * cliente que no recibió la respuesta reenvía el MISMO intento con el token
 * viejo y recupera la misma sucesora (`replayPristineSuccessor`) en lugar de
 * disparar la revocación masiva. Ver docs/ARCHITECTURE.md §32.
 */
export async function refresh(
  prisma: PrismaClient,
  params: { refreshToken: string; attemptId?: string } & RequestMeta,
): Promise<RefreshResult> {
  // Sin intento del cliente: uno aleatorio — ningún reenvío podrá reproducirlo.
  const attemptId = params.attemptId ?? generateRefreshAttemptId();
  const successorToken = deriveSuccessorRefreshToken(
    refreshRotationKey,
    params.refreshToken,
    attemptId,
  );
  const request: RotationRequest = {
    tokenHash: hashRefreshToken(params.refreshToken),
    successorToken,
    successorHash: hashRefreshToken(successorToken),
  };

  let outcome: RotationOutcome;
  try {
    outcome = await rotateSession(prisma, request, params);
  } catch (error) {
    if (!isTransactionUnavailable(error)) throw error;
    outcome = await resolveInterruptedRotation(prisma, request, params);
  }

  if (outcome.kind === 'invalid') {
    throw new InvalidSessionError();
  }

  await recordAuditLogSafe(prisma, {
    actorUserId: outcome.userId,
    action: outcome.kind === 'replayed' ? 'auth.refresh.replayed' : 'auth.refresh.rotated',
    entityType: 'Session',
    entityId: outcome.newSessionId,
    previousState: { sessionId: outcome.previousSessionId },
    newState: { sessionId: outcome.newSessionId },
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return {
    accessToken: outcome.accessToken,
    accessTokenExpiresInSeconds: accessTokenTtlSeconds,
    refreshToken: outcome.refreshToken,
    refreshTokenTtlSeconds,
  };
}

/**
 * `P2028` (la transacción no pudo iniciarse o expiró) y `P2034` (conflicto
 * de escritura/deadlock): en ambos casos Postgres revirtió TODO lo de esta
 * transacción. Son esperables bajo concurrencia real contra Neon — p. ej.
 * varios refresh simultáneos donde uno no consigue conexión dentro del
 * `maxWait` — y nunca deben llegar crudos al cliente como 500.
 */
function isTransactionUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2028' || error.code === 'P2034')
  );
}

/**
 * Etapa 5P — la transacción de rotación no confirmó nada (ver
 * `isTransactionUnavailable`). Se decide contra el estado REAL, releído
 * fuera de la transacción revertida:
 * - sesión revocada: otra solicitud ya consumió este token. Si fue el mismo
 *   intento (Etapa 5R), se reenvía su sucesora intacta; si no, esta es un
 *   perdedor de la carrera y se aplica la misma respuesta de seguridad que la
 *   rama `claim.count !== 1` (revocación conservadora + auditoría). Ambas, en
 *   una transacción NUEVA y corta — así el efecto no depende de la
 *   transacción que expiró;
 * - sesión inexistente o vencida: inválida, como siempre;
 * - sesión activa y vigente: nadie la tocó — fue una falla de
 *   infraestructura sin carrera. `503` reintentable: no se rota ni se
 *   revoca nada, y el refresh token del cliente sigue siendo válido.
 */
async function resolveInterruptedRotation(
  prisma: PrismaClient,
  request: RotationRequest,
  params: RequestMeta,
): Promise<RotationOutcome> {
  const session = await prisma.session.findUnique({
    where: { refreshTokenHash: request.tokenHash },
    select: { id: true, userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session) return { kind: 'invalid' };
  if (session.revokedAt === null) {
    if (session.expiresAt.getTime() < Date.now()) return { kind: 'invalid' };
    throw new SessionRefreshUnavailableError();
  }
  try {
    return await prisma.$transaction(async (tx): Promise<RotationOutcome> => {
      const replay = await replayPristineSuccessor(tx, session, request, params);
      if (replay) return replay;
      await revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.concurrent_rotation_detected',
        relatedSessionId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      return { kind: 'invalid' };
    });
  } catch (error) {
    // Sin la revocación confirmada no se afirma nada: reintentable, nunca 500.
    if (isTransactionUnavailable(error)) throw new SessionRefreshUnavailableError();
    throw error;
  }
}

async function rotateSession(
  prisma: PrismaClient,
  request: RotationRequest,
  params: RequestMeta,
): Promise<RotationOutcome> {
  return prisma.$transaction(async (tx): Promise<RotationOutcome> => {
    const session = await tx.session.findUnique({
      where: { refreshTokenHash: request.tokenHash },
    });
    if (!session) {
      return { kind: 'invalid' };
    }

    if (session.revokedAt) {
      // Token ya rotado. Si lo rotó este mismo intento y la respuesta se
      // perdió, se reenvía su sucesora intacta (Etapa 5R).
      const replay = await replayPristineSuccessor(tx, session, request, params);
      if (replay) return replay;
      // Reuso de un refresh token ya revocado: posible robo. Se revocan
      // TODAS las sesiones activas de ese usuario (no solo la reusada) —
      // el modelo actual no rastrea "familias" de tokens, así que la
      // respuesta segura y sin campos especulativos nuevos es cortar todo
      // acceso vigente de esa cuenta.
      await revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.reuse_detected',
        relatedSessionId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      return { kind: 'invalid' };
    }

    if (session.expiresAt.getTime() < Date.now()) {
      return { kind: 'invalid' };
    }

    const user = await tx.user.findUnique({
      where: { id: session.userId },
      select: { id: true, role: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') {
      return { kind: 'invalid' };
    }

    // Toma atómica de la sesión: solo una solicitud concurrente puede ganar
    // esta escritura condicionada (ver comentario de `refresh`). Si otra
    // ya la reclamó entre nuestra lectura y este `updateMany`, `count` da 0.
    const claim = await tx.session.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (claim.count !== 1) {
      const replay = await replayPristineSuccessor(tx, session, request, params);
      if (replay) return replay;
      await revokeAllActiveSessionsAndAudit(tx, {
        userId: session.userId,
        action: 'auth.refresh.concurrent_rotation_detected',
        relatedSessionId: session.id,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      return { kind: 'invalid' };
    }

    const newSession = await tx.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: request.successorHash,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
      },
      select: { id: true },
    });

    const accessToken = await signAccessToken(
      { userId: user.id, sessionId: newSession.id, role: user.role },
      accessTokenSecret,
      accessTokenTtlSeconds,
    );

    return {
      kind: 'rotated',
      accessToken,
      refreshToken: request.successorToken,
      previousSessionId: session.id,
      newSessionId: newSession.id,
      userId: user.id,
    };
  });
}

/**
 * Idempotente y sin revelar si el token existía: siempre "éxito" desde la
 * perspectiva del cliente. Si había una sesión activa para ese hash, se
 * revoca (nunca se borra la fila).
 *
 * Etapa 5R: si el token ya estaba rotado y el cliente informa el intento de
 * refresh que quedó en duda, se revoca también la sucesora intacta que ese
 * intento produjo — la sesión cuya respuesta nunca llegó no queda viva y
 * huérfana. Un logout nunca dispara la detección de reuso.
 */
export async function logout(
  prisma: PrismaClient,
  params: { refreshToken: string | undefined; attemptId?: string } & RequestMeta,
): Promise<void> {
  if (!params.refreshToken) {
    return;
  }
  const tokenHash = hashRefreshToken(params.refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });
  if (!session) {
    return;
  }
  let target: string = session.id;
  if (session.revokedAt) {
    if (!params.attemptId) return;
    const successorHash = hashRefreshToken(
      deriveSuccessorRefreshToken(refreshRotationKey, params.refreshToken, params.attemptId),
    );
    const successor = await prisma.session.findUnique({
      where: { refreshTokenHash: successorHash },
    });
    if (!successor || successor.userId !== session.userId || successor.revokedAt) return;
    target = successor.id;
  }
  const revoked = await prisma.session.updateMany({
    where: { id: target, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) return;
  await recordAuditLogSafe(prisma, {
    actorUserId: session.userId,
    action: 'auth.logout',
    entityType: 'Session',
    entityId: target,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });
}

export async function getPublicUserById(
  prisma: PrismaClient,
  userId: string,
): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_SELECT_FOR_AUTH,
  });
  if (!user) return null;
  return toPublicUser(user);
}
