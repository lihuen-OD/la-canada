import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDriveClient } from '../../driveBackup/driveClient';
import { createServiceAccountTokenProvider } from '../../driveBackup/googleAuth';
import { streamOf } from './fakes';

/**
 * Cliente REST de Drive y token de la cuenta de servicio contra un `fetch`
 * simulado: parámetros de unidades compartidas, ID pre-generado en la
 * creación, streaming con largo exacto, nada público y nada secreto en los
 * errores. Nunca habla con Google de verdad.
 */

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const token = Object.assign(async () => 'ya29.token-de-prueba', { reset: vi.fn() });

describe('cliente de Drive', () => {
  it('sube con el ID pre-generado, en la carpeta indicada, por streaming y sin permisos públicos', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) {
        return new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=SESION',
          },
        });
      }
      // Lee el cuerpo como lo haría la red.
      const body = await new Response(init?.body as ReadableStream).arrayBuffer();
      return json(200, { id: 'pre-generado-123', bytes: body.byteLength });
    });
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    await drive.uploadFile({
      id: 'pre-generado-123',
      name: '2026-10-02_recuerdo_x.jpg',
      parentId: 'carpeta-mes',
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      appProperties: { laCanadaFileAssetId: 'x' },
      body: streamOf(new Uint8Array([1, 2, 3, 4])),
    });

    const [start, upload] = calls;
    const startUrl = new URL(start!.url);
    expect(startUrl.pathname).toBe('/upload/drive/v3/files');
    expect(startUrl.searchParams.get('uploadType')).toBe('resumable');
    expect(startUrl.searchParams.get('supportsAllDrives')).toBe('true');
    expect(JSON.parse(String(start!.init.body))).toEqual({
      id: 'pre-generado-123',
      name: '2026-10-02_recuerdo_x.jpg',
      parents: ['carpeta-mes'],
      mimeType: 'image/jpeg',
      appProperties: { laCanadaFileAssetId: 'x' },
    });
    const startHeaders = new Headers(start!.init.headers);
    expect(startHeaders.get('x-upload-content-length')).toBe('4');
    expect(startHeaders.get('authorization')).toBe('Bearer ya29.token-de-prueba');

    expect(upload!.url).toContain('upload_id=SESION');
    expect(upload!.init.method).toBe('PUT');
    expect(upload!.init.body).toBeInstanceOf(ReadableStream);
    expect(new Headers(upload!.init.headers).get('content-length')).toBe('4');
    // Nunca se crean permisos ni se publica nada.
    expect(calls.some((call) => call.url.includes('/permissions'))).toBe(false);
  });

  it('409 al reintentar con el mismo ID → error de conflicto (no un duplicado)', async () => {
    const fetchImpl = vi.fn(async () =>
      json(409, { error: { errors: [{ reason: 'duplicate' }], code: 409 } }),
    );
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    await expect(
      drive.uploadFile({
        id: 'pre-generado-123',
        name: 'x.jpg',
        parentId: 'p',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        appProperties: {},
        body: streamOf(new Uint8Array([1])),
      }),
    ).rejects.toMatchObject({ kind: 'conflict', status: 409 });
  });

  it('un fallo de red no filtra la URL de la sesión de subida', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(null, {
          status: 200,
          headers: {
            location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=SESION',
          },
        });
      }
      throw new TypeError('fetch failed https://www.googleapis.com/upload?upload_id=SESION');
    });
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    const failure = await drive
      .uploadFile({
        id: 'i',
        name: 'x.jpg',
        parentId: 'p',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        appProperties: {},
        body: streamOf(new Uint8Array([1])),
      })
      .catch((error: Error) => error);
    expect(failure).toMatchObject({ kind: 'transient' });
    expect((failure as Error).message).not.toMatch(/SESION|https?:/);
  });

  it('una sesión que no es de Google se rechaza sin enviar la foto a otro lado', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 200, headers: { location: 'https://evil.example/upload' } }),
    );
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    await expect(
      drive.uploadFile({
        id: 'i',
        name: 'x',
        parentId: 'p',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        appProperties: {},
        body: streamOf(new Uint8Array([1])),
      }),
    ).rejects.toMatchObject({ kind: 'transient' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('búsqueda por marca de la app dentro de la unidad compartida, sin valores inyectables', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => json(200, { files: [] }));
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    await drive.findByAppProperty('laCanadaFileAssetId', '11111111-1111-4111-8111-111111111111', {
      driveId: 'drive-1',
    });
    const url = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(url.searchParams.get('q')).toBe(
      "appProperties has { key='laCanadaFileAssetId' and value='11111111-1111-4111-8111-111111111111' } and trashed = false",
    );
    expect(url.searchParams.get('corpora')).toBe('drive');
    expect(url.searchParams.get('driveId')).toBe('drive-1');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    await expect(
      drive.findByAppProperty('k', "x' or name contains 'a", { driveId: null }),
    ).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('archivo inexistente → null; 403 de permisos → error de configuración; 401 renueva el token', async () => {
    const responses = [
      json(404, { error: { errors: [{ reason: 'notFound' }] } }),
      json(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } }),
      json(401, { error: { errors: [{ reason: 'authError' }] } }),
    ];
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift()!);
    const drive = createDriveClient(token, fetchImpl as typeof fetch);
    expect(await drive.getFile('a')).toBeNull();
    await expect(drive.getFile('b')).rejects.toMatchObject({ kind: 'config' });
    await expect(drive.getFile('c')).rejects.toMatchObject({ kind: 'transient' });
    expect(token.reset).toHaveBeenCalled();
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('supportsAllDrives=true');
  });

  it('destino: distingue la raíz de una unidad compartida de una carpeta, con sus permisos', async () => {
    const root = createDriveClient(token, (async () =>
      json(200, {
        id: '0AKPasFkRa2CPUk9PVA',
        name: 'La Cañada',
        capabilities: { canAddChildren: true, canListChildren: true, canDeleteChildren: false },
      })) as typeof fetch);
    expect(await root.describeDestination('0AKPasFkRa2CPUk9PVA')).toMatchObject({
      kind: 'shared_drive_root',
      driveId: '0AKPasFkRa2CPUk9PVA',
      canAddChildren: true,
      canDeleteChildren: false,
    });

    const answers = [
      json(404, { error: { errors: [{ reason: 'notFound' }] } }),
      json(200, {
        id: 'carpeta-1',
        name: 'Fotos',
        mimeType: 'application/vnd.google-apps.folder',
        driveId: '0AKPasFkRa2CPUk9PVA',
        capabilities: { canAddChildren: true },
      }),
    ];
    const folder = createDriveClient(token, (async () => answers.shift()!) as typeof fetch);
    expect(await folder.describeDestination('carpeta-1')).toMatchObject({
      kind: 'folder',
      driveId: '0AKPasFkRa2CPUk9PVA',
    });
  });
});

describe('token de la cuenta de servicio', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'la-canada-drive-'));
  const file = join(dir, 'cuenta.json');
  writeFileSync(
    file,
    JSON.stringify({
      type: 'service_account',
      client_email: 'sintetica@ejemplo.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      private_key_id: 'kid-sintetico',
    }),
  );

  it('firma un JWT RS256 válido con alcance de Drive y lo reutiliza hasta que vence', async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { access_token: 'ya29.nuevo', expires_in: 3600 }),
    );
    const provider = createServiceAccountTokenProvider(file, fetchImpl as typeof fetch);
    expect(await provider()).toBe('ya29.nuevo');
    expect(await provider()).toBe('ya29.nuevo');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    const [header, claims, signature] = form.get('assertion')!.split('.');
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature!, 'base64url'),
      ),
    ).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: 'sintetica@ejemplo.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
    });
  });

  it('archivo inexistente o credenciales rechazadas → error de configuración sin secretos', async () => {
    const missing = createServiceAccountTokenProvider(join(dir, 'no-existe.json'));
    await expect(missing()).rejects.toMatchObject({ kind: 'config' });

    const rejected = createServiceAccountTokenProvider(file, (async () =>
      json(400, { error: 'invalid_grant', error_description: 'clave revocada' })) as typeof fetch);
    const error = (await rejected().catch((caught: Error) => caught)) as Error;
    expect(error).toMatchObject({ kind: 'config' });
    expect(error.message).toMatch(/invalid_grant/);
    expect(error.message).not.toMatch(/PRIVATE|clave revocada|sintetica@/);
  });
});
