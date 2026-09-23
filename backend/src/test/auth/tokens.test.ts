import { beforeAll, describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  AccessTokenExpiredError,
  AccessTokenInvalidError,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../../auth/tokens';

const SECRET = new TextEncoder().encode('a'.repeat(32));
const OTHER_SECRET = new TextEncoder().encode('b'.repeat(32));

// UUIDs reales (no "1111...-1111"): `verifyAccessToken` valida `sub`/`sid`
// con `z.string().uuid()`, estricto con RFC 4122 (nibble de versión/variante).
const CLAIMS = {
  userId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  role: 'EMPLOYEE' as const,
};

// `jose` es ESM-only — mismo motivo que en `auth/tokens.ts`: import dinámico
// tipado con `resolution-mode`, nunca un `import` estático desde este
// archivo (compila como CommonJS).
type JoseModule = typeof import('jose', { with: { 'resolution-mode': 'import' } });
let SignJWT: JoseModule['SignJWT'];

beforeAll(async () => {
  ({ SignJWT } = await import('jose'));
});

describe('signAccessToken / verifyAccessToken', () => {
  it('firma y verifica un token válido — el payload trae exactamente sub/sid/role/iat/exp', async () => {
    const token = await signAccessToken(CLAIMS, SECRET, 60);
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.sub).toBe(CLAIMS.userId);
    expect(payload.sid).toBe(CLAIMS.sessionId);
    expect(payload.role).toBe('EMPLOYEE');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('rechaza un token vencido con AccessTokenExpiredError', async () => {
    const token = await signAccessToken(CLAIMS, SECRET, -10);
    await expect(verifyAccessToken(token, SECRET)).rejects.toBeInstanceOf(AccessTokenExpiredError);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const token = await signAccessToken(CLAIMS, OTHER_SECRET, 60);
    await expect(verifyAccessToken(token, SECRET)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it('rechaza un token con issuer incorrecto', async () => {
    const bad = await new SignJWT({ sid: CLAIMS.sessionId, role: CLAIMS.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setIssuer('otro-issuer')
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .sign(SECRET);
    await expect(verifyAccessToken(bad, SECRET)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it('rechaza un token con audience incorrecta', async () => {
    const bad = await new SignJWT({ sid: CLAIMS.sessionId, role: CLAIMS.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience('otra-audience')
      .sign(SECRET);
    await expect(verifyAccessToken(bad, SECRET)).rejects.toBeInstanceOf(AccessTokenInvalidError);
  });

  it('rechaza un token con algoritmo "none" (nunca se acepta)', async () => {
    // Construido a mano: header alg=none, sin firma real — simula el ataque clásico de JWT "alg=none".
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: CLAIMS.userId,
        sid: CLAIMS.sessionId,
        role: CLAIMS.role,
        iss: ACCESS_TOKEN_ISSUER,
        aud: ACCESS_TOKEN_AUDIENCE,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const noneAlgToken = `${header}.${payload}.`;
    await expect(verifyAccessToken(noneAlgToken, SECRET)).rejects.toBeInstanceOf(
      AccessTokenInvalidError,
    );
  });

  it('rechaza un payload con forma inesperada (falta sid) aunque la firma sea válida', async () => {
    const badShape = await new SignJWT({ role: CLAIMS.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .sign(SECRET);
    await expect(verifyAccessToken(badShape, SECRET)).rejects.toBeInstanceOf(
      AccessTokenInvalidError,
    );
  });
});

describe('refresh token opaco', () => {
  it('generateRefreshToken produce valores distintos y suficientemente largos (256 bits en base64url)', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    // 32 bytes en base64url ≈ 43 caracteres, sin relleno.
    expect(a.length).toBeGreaterThanOrEqual(42);
  });

  it('hashRefreshToken es determinístico y nunca igual al token original', () => {
    const token = generateRefreshToken();
    const hash1 = hashRefreshToken(token);
    const hash2 = hashRefreshToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });

  it('hashRefreshToken produce hashes distintos para tokens distintos', () => {
    const hash1 = hashRefreshToken(generateRefreshToken());
    const hash2 = hashRefreshToken(generateRefreshToken());
    expect(hash1).not.toBe(hash2);
  });
});
