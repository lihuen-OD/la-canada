import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';

/**
 * `jose` es ESM-only (`"type": "module"`, sin entrypoint CJS) — este
 * backend compila como CommonJS (sin `"type": "module"` en
 * `backend/package.json`, a propósito, ver Etapa 3B.1). Un `import`
 * estático de un paquete ESM-only desde un archivo CJS no funciona en
 * runtime aunque TypeScript lo deje pasar en algunas configuraciones; acá
 * directamente no compila (Node16 module resolution lo señala en build).
 * Se importa de forma dinámica y se cachea la promesa — nunca se vuelve a
 * pagar el costo del `import()` después del primer uso.
 */
type JoseModule = typeof import('jose', { with: { 'resolution-mode': 'import' } });
let josePromise: Promise<JoseModule> | undefined;
function loadJose(): Promise<JoseModule> {
  josePromise ??= import('jose');
  return josePromise;
}

/** Propios de La Cañada — un token firmado por este backend nunca debe validar en ningún otro emisor/audiencia. */
export const ACCESS_TOKEN_ISSUER = 'la-canada-api';
export const ACCESS_TOKEN_AUDIENCE = 'la-canada-frontend';
/** Explícito siempre — `jwtVerify` nunca acepta "none" ni infiere el algoritmo del propio token. */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';

const AccessTokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  role: z.enum(['ADMIN', 'EMPLOYEE']),
  iat: z.number(),
  exp: z.number(),
});

export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  role: 'ADMIN' | 'EMPLOYEE';
}

/**
 * Claims mínimos a propósito: `sub` (usuario), `sid` (sesión — permite
 * revocar sin esperar a que expire), `role` (para autorización rápida,
 * nunca la única fuente de verdad — ver `requireAuth`), `iat`/`exp`, más
 * issuer/audience propios. Nada de nombre, contraseña ni otro dato
 * personal.
 */
export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: Uint8Array,
  ttlSeconds: number,
): Promise<string> {
  const { SignJWT } = await loadJose();
  const nowSeconds = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: claims.sessionId, role: claims.role })
    .setProtectedHeader({ alg: ACCESS_TOKEN_ALGORITHM, typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .setIssuer(ACCESS_TOKEN_ISSUER)
    .setAudience(ACCESS_TOKEN_AUDIENCE)
    .sign(secret);
}

export class AccessTokenExpiredError extends Error {}
export class AccessTokenInvalidError extends Error {}

/**
 * `jwtVerify` ya valida firma, algoritmo (restringido a `algorithms`),
 * issuer y audience, y expiración — acá solo se traducen sus errores a
 * los dos casos que le importan al resto del código (expirado vs.
 * cualquier otro motivo de invalidez) y se valida la *forma* del payload
 * con Zod (nunca se confía en que el JWT trae exactamente los campos
 * esperados solo porque la firma es válida).
 */
export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
): Promise<AccessTokenPayload> {
  const { jwtVerify, errors: joseErrors } = await loadJose();
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      issuer: ACCESS_TOKEN_ISSUER,
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    const parsed = AccessTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AccessTokenInvalidError('Payload del access token con forma inesperada.');
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new AccessTokenExpiredError('Access token vencido.');
    }
    if (error instanceof AccessTokenInvalidError) {
      throw error;
    }
    throw new AccessTokenInvalidError('Access token inválido.');
  }
}

/** Opaco, criptográficamente aleatorio, 256 bits — nunca un JWT (ver docs/SECURITY.md, "Refresh token"). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Determinístico (SHA-256) — lo único que se persiste en `Session.refreshTokenHash`, nunca el token original. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
