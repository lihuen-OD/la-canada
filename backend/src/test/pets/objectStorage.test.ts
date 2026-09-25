import { describe, expect, it, vi } from 'vitest';
import {
  createObjectStorageClient,
  readObjectStorageConfig,
  signRequest,
  uriEncode,
} from '../../lib/objectStorage';

/**
 * Vectores oficiales de AWS ("Signature Calculations for the Authorization
 * Header: Transferring Payload in a Single Chunk", ejemplos de S3). Las
 * credenciales son las de EJEMPLO públicas de la documentación de AWS.
 */
const EXAMPLE = {
  host: 'examplebucket.s3.amazonaws.com',
  amzDate: '20130524T000000Z',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('AWS Signature V4 (vectores oficiales)', () => {
  it('GET Object con Range', () => {
    const headers = signRequest({
      ...EXAMPLE,
      method: 'GET',
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: EMPTY_SHA256,
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('GET Bucket (listado) con query ordenada', () => {
    const headers = signRequest({
      ...EXAMPLE,
      method: 'GET',
      path: '/',
      query: { 'max-keys': '2', prefix: 'J' },
      payloadHash: EMPTY_SHA256,
    });
    expect(headers.authorization).toContain(
      'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });

  it('codifica según RFC 3986 y respeta "/" en el path', () => {
    expect(uriEncode("a b!'()*/ñ", false)).toBe('a%20b%21%27%28%29%2A/%C3%B1');
    expect(uriEncode('a/b')).toBe('a%2Fb');
  });
});

describe('configuración', () => {
  const full = {
    OBJECT_STORAGE_ENDPOINT: 'https://storage.example.test/',
    OBJECT_STORAGE_REGION: 'region-test',
    OBJECT_STORAGE_BUCKET: 'bucket-test',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'id-test',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-test',
  };
  it('exige las 5 variables; vacías = sin almacenamiento', () => {
    expect(readObjectStorageConfig(full as never)?.endpoint).toBe('https://storage.example.test');
    for (const key of Object.keys(full)) {
      expect(readObjectStorageConfig({ ...full, [key]: '  ' } as never)).toBeNull();
    }
  });
});

describe('cliente', () => {
  const storageConfig = {
    endpoint: 'https://storage.example.test/base',
    region: 'region-test',
    bucket: 'bucket-test',
    accessKeyId: 'id-test',
    secretAccessKey: 'secret-test',
  };

  it('PUT path-style firmado, con content-type y hash real del cuerpo; nunca expone la clave secreta', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 200, headers: { etag: '"abc"' } }),
    );
    const client = createObjectStorageClient(storageConfig, fetchMock as never);
    const result = await client.putObject('animals/x/y.webp', Buffer.from('hola'), 'image/webp');
    expect(result.etag).toBe('"abc"');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://storage.example.test/base/bucket-test/animals/x/y.webp');
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('PUT');
    expect(headers['content-type']).toBe('image/webp');
    expect(headers['x-amz-content-sha256']).toBe(
      'b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79',
    );
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id-test\//);
    expect(JSON.stringify(init)).not.toContain('secret-test');
  });

  it('GET 404 → null; errores del proveedor o de red → ObjectStorageRequestError', async () => {
    const notFound = createObjectStorageClient(
      storageConfig,
      (async () => new Response(null, { status: 404 })) as never,
    );
    expect(await notFound.getObject('k')).toBeNull();
    const failing = createObjectStorageClient(
      storageConfig,
      (async () => new Response(null, { status: 403 })) as never,
    );
    await expect(failing.putObject('k', Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      name: 'ObjectStorageRequestError',
      status: 403,
    });
    const offline = createObjectStorageClient(storageConfig, (async () => {
      throw new TypeError('fetch failed');
    }) as never);
    await expect(offline.deleteObject('k')).rejects.toMatchObject({ status: null });
  });
});
