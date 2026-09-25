import { createHash, createHmac } from 'node:crypto';
import { env } from '../config';

/**
 * Cliente mínimo de Neon Object Storage (interfaz compatible con S3, bucket
 * privado) — Etapa 5M. Solo el backend lo usa y solo el backend tiene las
 * credenciales (`OBJECT_STORAGE_*`, nunca `VITE_*`). Tres operaciones
 * (PUT/GET/DELETE de un objeto) firmadas con AWS Signature Version 4 en el
 * header `Authorization`, URLs path-style (`<endpoint>/<bucket>/<key>`).
 *
 * Sin SDK a propósito: tres requests firmadas no justifican una dependencia
 * grande, y los SDK recientes agregan por defecto headers de checksum que
 * varios proveedores S3-compatibles rechazan. La firma se verifica contra los
 * vectores oficiales de la documentación de AWS (`objectStorage.test.ts`).
 *
 * Nunca se persiste ni se expone una URL del bucket: el frontend recibe la
 * imagen a través de un endpoint autenticado del backend (proxy).
 */

export interface ObjectStorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StoredObject {
  body: Buffer;
  contentType: string | null;
  etag: string | null;
}

export interface ObjectStorageClient {
  readonly bucket: string;
  putObject(key: string, body: Buffer, contentType: string): Promise<{ etag: string | null }>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
}

export class ObjectStorageRequestError extends Error {
  constructor(
    readonly operation: string,
    readonly status: number | null,
  ) {
    super(`Object Storage ${operation} falló${status ? ` (HTTP ${status})` : ''}.`);
    this.name = 'ObjectStorageRequestError';
  }
}

const trimmed = (value: string | undefined): string | undefined =>
  value && value.trim() !== '' ? value.trim() : undefined;

/** Las 5 variables son obligatorias juntas; con cualquiera vacía, no hay almacenamiento. */
export function readObjectStorageConfig(source = env): ObjectStorageConfig | null {
  const endpoint = trimmed(source.OBJECT_STORAGE_ENDPOINT);
  const region = trimmed(source.OBJECT_STORAGE_REGION);
  const bucket = trimmed(source.OBJECT_STORAGE_BUCKET);
  const accessKeyId = trimmed(source.OBJECT_STORAGE_ACCESS_KEY_ID);
  const secretAccessKey = trimmed(source.OBJECT_STORAGE_SECRET_ACCESS_KEY);
  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint: endpoint.replace(/\/+$/, ''), region, bucket, accessKeyId, secretAccessKey };
}

// ── AWS Signature Version 4 ───────────────────────────────────────────────

const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 como exige SigV4 (`encodeURIComponent` deja `!'()*` sin codificar). */
export function uriEncode(value: string, encodeSlash = true): string {
  return Array.from(value)
    .map((char) => {
      if (/[A-Za-z0-9\-._~]/.test(char)) return char;
      if (char === '/' && !encodeSlash) return char;
      return Array.from(Buffer.from(char, 'utf8'))
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('');
    })
    .join('');
}

export interface SignableRequest {
  method: string;
  host: string;
  /** Path ya armado (sin codificar); cada segmento se codifica acá. */
  path: string;
  query?: Readonly<Record<string, string>>;
  /** Headers a firmar además de host/x-amz-date/x-amz-content-sha256 (nombres en minúsculas). */
  headers?: Readonly<Record<string, string>>;
  payloadHash: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  amzDate: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  service?: string;
}

/** Devuelve los headers a enviar, incluido `Authorization`. Función pura. */
export function signRequest(request: SignableRequest): Record<string, string> {
  const service = request.service ?? 's3';
  const dateStamp = request.amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...request.headers,
    host: request.host,
    'x-amz-content-sha256': request.payloadHash,
    'x-amz-date': request.amzDate,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.entries(request.query ?? {})
    .map(([key, value]) => [uriEncode(key), uriEncode(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const canonicalRequest = [
    request.method,
    uriEncode(request.path, false),
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${request.region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    request.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, dateStamp), request.region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

const amzDateOf = (now: Date): string => now.toISOString().replace(/[-:]|\.\d{3}/g, '');

const REQUEST_TIMEOUT_MS = 15_000;

/** Cliente real sobre `fetch` nativo. */
export function createObjectStorageClient(
  storageConfig: ObjectStorageConfig,
  fetchImpl: typeof fetch = fetch,
): ObjectStorageClient {
  const base = new URL(storageConfig.endpoint);
  const basePath = base.pathname.replace(/\/+$/, '');

  async function send(
    operation: string,
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const path = `${basePath}/${storageConfig.bucket}/${key}`;
    const payload = body ?? Buffer.alloc(0);
    const headers = signRequest({
      method,
      host: base.host,
      path,
      headers: contentType ? { 'content-type': contentType } : undefined,
      payloadHash: sha256Hex(payload),
      amzDate: amzDateOf(new Date()),
      region: storageConfig.region,
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
    });
    delete headers.host; // lo agrega fetch a partir de la URL
    try {
      return await fetchImpl(`${base.protocol}//${base.host}${uriEncode(path, false)}`, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ObjectStorageRequestError(operation, null);
    }
  }

  return {
    bucket: storageConfig.bucket,
    async putObject(key, body, contentType) {
      const response = await send('PUT', 'PUT', key, body, contentType);
      if (!response.ok) throw new ObjectStorageRequestError('PUT', response.status);
      return { etag: response.headers.get('etag') };
    },
    async getObject(key) {
      const response = await send('GET', 'GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new ObjectStorageRequestError('GET', response.status);
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
      };
    },
    async deleteObject(key) {
      const response = await send('DELETE', 'DELETE', key);
      // S3 responde 204 también si el objeto no existía: idempotente.
      if (!response.ok && response.status !== 404) {
        throw new ObjectStorageRequestError('DELETE', response.status);
      }
    },
  };
}

// ── Instancia del proceso ─────────────────────────────────────────────────

let override: ObjectStorageClient | null | undefined;
let cached: ObjectStorageClient | null | undefined;

/** `null` = no configurado (las fotos quedan deshabilitadas, el resto del módulo funciona). */
export function getObjectStorage(): ObjectStorageClient | null {
  if (override !== undefined) return override;
  if (cached === undefined) {
    const storageConfig = readObjectStorageConfig();
    cached = storageConfig ? createObjectStorageClient(storageConfig) : null;
  }
  return cached;
}

/** Solo tests: reemplaza el cliente (un fake en memoria, o `null` = sin configurar). `undefined` restaura. */
export function setObjectStorageForTests(client: ObjectStorageClient | null | undefined): void {
  override = client;
}
