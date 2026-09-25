import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { accessTokenSecret } from '../auth/config';
import { AccessTokenExpiredError, verifyAccessToken } from '../auth/tokens';
import type { AuthContext } from '../auth/types';
import {
  AuthenticationRequiredError,
  ExpiredAccessTokenError,
  InvalidAccessTokenError,
} from '../errors/AppError';

/** Fila de la única consulta de autenticación (ver `requireAuth`). */
interface AuthRow {
  sessionId: string;
  sessionUserId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  role: string;
  status: string;
  employeeId: string | null;
  employeeActive: boolean | null;
}

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? (match[1] ?? null) : null;
}

/**
 * En cada request protegido: 1) valida el access token (firma, algoritmo,
 * issuer, audience, expiración — ver `auth/tokens.ts`); 2) valida la forma
 * del payload con Zod (ídem); 3) confirma en base que el usuario existe y
 * está ACTIVE, y que la sesión existe, no está revocada ni vencida —
 * NUNCA confía solamente en el JWT para esto, porque un usuario puede
 * suspenderse o una sesión puede revocarse después de emitido un token
 * todavía sin expirar. El `role` que queda en `req.auth` es siempre el de
 * la base al momento del request, no el claim del JWT (ver `auth/types.ts`).
 * 4) exige además que `session.userId === payload.sub`: un token firmado
 * correctamente (misma clave, misma firma) pero cuyo `sub` no coincide con
 * el dueño real de la sesión (`sid`) igual se rechaza — la sesión por sí
 * sola no alcanza como prueba de identidad si dice pertenecer a otro
 * usuario. Nunca se revela en la respuesta cuál de las dos validaciones
 * falló.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next(new AuthenticationRequiredError());
    return;
  }

  let sessionId: string;
  let userId: string;
  try {
    const payload = await verifyAccessToken(token, accessTokenSecret);
    sessionId = payload.sid;
    userId = payload.sub;
  } catch (error) {
    next(
      error instanceof AccessTokenExpiredError
        ? new ExpiredAccessTokenError()
        : new InvalidAccessTokenError(),
    );
    return;
  }

  // Etapa 5P: sesión + usuario + empleado en UNA sentencia SQL. Un `select`
  // anidado de Prisma parece una sola consulta pero el cliente la ejecuta
  // como tres (una por relación, verificado contra Postgres real en
  // `requireAuth.integration.test.ts`); `relationJoins` requeriría cambiar el
  // schema. SQL estático y parametrizado: `sid` viaja como parámetro (ya
  // validado como UUID por el esquema del JWT), nunca interpolado. Las
  // verificaciones son exactamente las mismas de siempre.
  const rows = await prisma.$queryRaw<AuthRow[]>(Prisma.sql`
    SELECT s."id" AS "sessionId", s."user_id" AS "sessionUserId",
           s."revoked_at" AS "revokedAt", s."expires_at" AS "expiresAt",
           u."role"::text AS "role", u."status"::text AS "status",
           e."id" AS "employeeId", e."active" AS "employeeActive"
    FROM "sessions" s
    JOIN "users" u ON u."id" = s."user_id"
    LEFT JOIN "employees" e ON e."id" = u."employee_id"
    WHERE s."id" = ${sessionId}::uuid
    LIMIT 1`);
  const row = rows[0];
  if (
    !row ||
    row.revokedAt !== null ||
    new Date(row.expiresAt).getTime() < Date.now() ||
    row.sessionUserId !== userId
  ) {
    next(new AuthenticationRequiredError());
    return;
  }

  if (row.status !== 'ACTIVE' || (row.role !== 'ADMIN' && row.role !== 'EMPLOYEE')) {
    next(new AuthenticationRequiredError());
    return;
  }

  const authContext: AuthContext = {
    userId: row.sessionUserId,
    sessionId: row.sessionId,
    role: row.role,
    employeeId: row.employeeId !== null && row.employeeActive === true ? row.employeeId : null,
  };
  req.auth = authContext;
  next();
}
