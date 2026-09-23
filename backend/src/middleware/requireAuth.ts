import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { accessTokenSecret } from '../auth/config';
import { AccessTokenExpiredError, verifyAccessToken } from '../auth/tokens';
import type { AuthContext } from '../auth/types';
import {
  AuthenticationRequiredError,
  ExpiredAccessTokenError,
  InvalidAccessTokenError,
} from '../errors/AppError';

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

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    next(new AuthenticationRequiredError());
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') {
    next(new AuthenticationRequiredError());
    return;
  }

  const authContext: AuthContext = { userId: user.id, sessionId: session.id, role: user.role };
  req.auth = authContext;
  next();
}
