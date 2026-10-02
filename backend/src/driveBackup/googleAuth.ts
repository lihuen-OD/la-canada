import { createPrivateKey, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DriveBackupError, googleReason } from './errors';

/**
 * Token de acceso de la cuenta de servicio (OAuth 2.0 JWT bearer, RFC 7523),
 * sin SDK: la firma RS256 es de `node:crypto`. El JSON se lee del disco
 * recién cuando hace falta un token y su contenido nunca sale de esta
 * función: ni la clave privada ni el token se registran ni se persisten.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Unidad compartida existente (no creada por la app): `drive.file` no alcanza. */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const TOKEN_TIMEOUT_MS = 15_000;
const RENEW_MARGIN_MS = 5 * 60_000;

export type AccessTokenProvider = () => Promise<string>;

export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | undefined;
}

async function readServiceAccount(credentialsFile: string): Promise<ServiceAccountKey> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(credentialsFile, 'utf8'));
  } catch {
    throw new DriveBackupError(
      'config',
      'No se pudo leer el archivo de credenciales de Drive (DRIVE_BACKUP_CREDENTIALS_FILE).',
    );
  }
  const json = parsed as Record<string, unknown>;
  if (
    json.type !== 'service_account' ||
    typeof json.client_email !== 'string' ||
    typeof json.private_key !== 'string'
  ) {
    throw new DriveBackupError(
      'config',
      'El archivo de credenciales de Drive no es una clave de cuenta de servicio.',
    );
  }
  return {
    clientEmail: json.client_email,
    privateKey: json.private_key,
    privateKeyId: typeof json.private_key_id === 'string' ? json.private_key_id : undefined,
  };
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** JWT RS256 de la cuenta de servicio (`iss`, `scope`, `aud`, `iat`, `exp` = 1 h). */
export function signAssertion(key: ServiceAccountKey, issuedAtSeconds: number): string {
  const header = base64url(
    JSON.stringify({
      alg: 'RS256',
      typ: 'JWT',
      ...(key.privateKeyId ? { kid: key.privateKeyId } : {}),
    }),
  );
  const claims = base64url(
    JSON.stringify({
      iss: key.clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + 3600,
    }),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${claims}`),
    createPrivateKey(key.privateKey),
  );
  return `${header}.${claims}.${base64url(signature)}`;
}

export function createServiceAccountTokenProvider(
  credentialsFile: string,
  fetchImpl: typeof fetch = fetch,
): AccessTokenProvider & { reset(): void } {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function issue(): Promise<string> {
    const key = await readServiceAccount(credentialsFile);
    let assertion: string;
    try {
      assertion = signAssertion(key, Math.floor(Date.now() / 1000));
    } catch {
      throw new DriveBackupError(
        'config',
        'La clave privada de la cuenta de servicio es inválida.',
      );
    }
    let response: Response;
    try {
      response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch {
      throw new DriveBackupError('transient', 'No se pudo obtener un token de Google (red).');
    }
    const body = (await response.json().catch(() => null)) as {
      access_token?: unknown;
      expires_in?: unknown;
    } | null;
    if (!response.ok || typeof body?.access_token !== 'string') {
      const reason = googleReason(body);
      throw new DriveBackupError(
        response.status >= 500 || response.status === 429 ? 'transient' : 'config',
        `Google rechazó las credenciales de la cuenta de servicio (HTTP ${response.status}${
          reason ? `, ${reason}` : ''
        }).`,
        response.status,
      );
    }
    const ttlMs = (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000;
    cached = { token: body.access_token, expiresAt: Date.now() + ttlMs };
    return body.access_token;
  }

  const provider = async () => {
    if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;
    inFlight ??= issue().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  provider.reset = () => {
    cached = null;
  };
  return provider;
}
