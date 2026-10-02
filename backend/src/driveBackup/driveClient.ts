import type { AccessTokenProvider } from './googleAuth';
import { DriveBackupError, httpError } from './errors';

/**
 * Cliente mínimo de Google Drive API v3 (Etapa 5Z), sin SDK — mismo criterio
 * que `lib/objectStorage.ts`: pocas llamadas REST no justifican una
 * dependencia grande. Toda llamada lleva `supportsAllDrives=true` (destino en
 * una unidad compartida) y un timeout propio.
 *
 * Identidad de cada copia: un ID pre-generado con `files.generateIds` que se
 * envía en la creación. Según la guía oficial de subidas, reintentar con un ID
 * pre-generado es seguro ante errores indeterminados o timeouts: si la
 * creación ya había funcionado, el reintento responde `409 Conflict` y no se
 * crea un duplicado. Los archivos nunca se publican ni reciben permisos.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const METADATA_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;
const FILE_FIELDS = 'id,name,mimeType,parents,trashed,size,appProperties,driveId';

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed: boolean;
  size: number | null;
  appProperties: Record<string, string>;
  driveId: string | null;
}

export interface DriveDestinationInfo {
  /** `shared_drive_root`: el ID es una unidad compartida; `folder`: una carpeta. */
  kind: 'shared_drive_root' | 'folder' | 'other';
  id: string;
  name: string;
  driveId: string | null;
  canAddChildren: boolean | null;
  canListChildren: boolean | null;
  /** `false` es lo esperado con rol Colaborador: la app nunca borra. */
  canDeleteChildren: boolean | null;
}

export interface UploadInput {
  id: string;
  name: string;
  parentId: string;
  mimeType: string;
  sizeBytes: number;
  appProperties: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

export interface DriveClient {
  generateId(): Promise<string>;
  /** `null` si no existe o no es visible. */
  getFile(id: string): Promise<DriveFileInfo | null>;
  /** Búsqueda por `appProperties` dentro de una unidad compartida (o en todas si `driveId` es null). */
  findByAppProperty(
    key: string,
    value: string,
    options: { driveId: string | null; parentId?: string; folder?: boolean },
  ): Promise<DriveFileInfo[]>;
  /** Lanza `DriveBackupError('conflict')` si el ID ya existe. */
  createFolder(input: {
    id: string;
    name: string;
    parentId: string;
    appProperties: Record<string, string>;
  }): Promise<void>;
  /** Subida reanudable con el ID pre-generado. `conflict` si el ID ya existe. */
  uploadFile(input: UploadInput): Promise<void>;
  describeDestination(id: string): Promise<DriveDestinationInfo>;
}

function toFileInfo(raw: Record<string, unknown>): DriveFileInfo {
  const size = typeof raw.size === 'string' ? Number(raw.size) : null;
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' ? raw.name : '',
    mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
    parents: Array.isArray(raw.parents) ? raw.parents.map(String) : [],
    trashed: raw.trashed === true,
    size: size !== null && Number.isFinite(size) ? size : null,
    appProperties:
      raw.appProperties && typeof raw.appProperties === 'object'
        ? (raw.appProperties as Record<string, string>)
        : {},
    driveId: typeof raw.driveId === 'string' ? raw.driveId : null,
  };
}

/** Valores seguros para una consulta `q` (UUID, rutas propias): sin comillas ni barras. */
function assertQuerySafe(value: string): string {
  if (!/^[A-Za-z0-9_./-]{1,100}$/.test(value)) {
    throw new DriveBackupError('invalid', 'Valor no admitido en una consulta de Drive.');
  }
  return value;
}

export function createDriveClient(
  getToken: AccessTokenProvider & { reset?(): void },
  fetchImpl: typeof fetch = fetch,
): DriveClient {
  async function call(
    operation: string,
    url: string,
    init: RequestInit & { timeoutMs?: number; duplex?: 'half' } = {},
  ): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(init.timeoutMs ?? METADATA_TIMEOUT_MS),
      } as RequestInit);
    } catch (error) {
      if (error instanceof DriveBackupError) throw error;
      // Nunca se propaga el error original: podría incluir la URL de la sesión de subida.
      throw new DriveBackupError('transient', `Drive ${operation}: sin respuesta (red o timeout).`);
    }
    if (response.status === 401) getToken.reset?.();
    return response;
  }

  async function failure(operation: string, response: Response): Promise<DriveBackupError> {
    const body = await response.json().catch(() => null);
    return httpError(operation, response.status, body);
  }

  const withDrives = (params: Record<string, string>) =>
    new URLSearchParams({ supportsAllDrives: 'true', ...params }).toString();

  return {
    async generateId() {
      const response = await call(
        'generateIds',
        `${API}/files/generateIds?${new URLSearchParams({ count: '1', space: 'drive', type: 'files' })}`,
      );
      if (!response.ok) throw await failure('generateIds', response);
      const body = (await response.json()) as { ids?: unknown };
      const id = Array.isArray(body.ids) ? body.ids[0] : undefined;
      if (typeof id !== 'string') {
        throw new DriveBackupError('transient', 'Drive generateIds no devolvió un ID.');
      }
      return id;
    },

    async getFile(id) {
      const response = await call(
        'files.get',
        `${API}/files/${encodeURIComponent(id)}?${withDrives({ fields: FILE_FIELDS })}`,
      );
      if (response.status === 404) return null;
      if (!response.ok) throw await failure('files.get', response);
      return toFileInfo((await response.json()) as Record<string, unknown>);
    },

    async findByAppProperty(key, value, options) {
      const clauses = [
        `appProperties has { key='${assertQuerySafe(key)}' and value='${assertQuerySafe(value)}' }`,
        'trashed = false',
      ];
      if (options.parentId) clauses.push(`'${assertQuerySafe(options.parentId)}' in parents`);
      if (options.folder) clauses.push(`mimeType = '${FOLDER_MIME}'`);
      const params: Record<string, string> = {
        q: clauses.join(' and '),
        fields: `files(${FILE_FIELDS})`,
        pageSize: '10',
        includeItemsFromAllDrives: 'true',
        ...(options.driveId
          ? { corpora: 'drive', driveId: options.driveId }
          : { corpora: 'allDrives' }),
      };
      const response = await call('files.list', `${API}/files?${withDrives(params)}`);
      if (!response.ok) throw await failure('files.list', response);
      const body = (await response.json()) as { files?: unknown };
      return Array.isArray(body.files)
        ? body.files.map((file) => toFileInfo(file as Record<string, unknown>))
        : [];
    },

    async createFolder(input) {
      const response = await call('files.create', `${API}/files?${withDrives({ fields: 'id' })}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({
          id: input.id,
          name: input.name,
          mimeType: FOLDER_MIME,
          parents: [input.parentId],
          appProperties: input.appProperties,
        }),
      });
      if (!response.ok) throw await failure('files.create (carpeta)', response);
    },

    async uploadFile(input) {
      // 1) Sesión reanudable: los metadatos (con el ID pre-generado) van primero.
      const start = await call(
        'upload (inicio)',
        `${UPLOAD_API}/files?${withDrives({ uploadType: 'resumable', fields: 'id' })}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json; charset=UTF-8',
            'x-upload-content-type': input.mimeType,
            'x-upload-content-length': String(input.sizeBytes),
          },
          body: JSON.stringify({
            id: input.id,
            name: input.name,
            parents: [input.parentId],
            mimeType: input.mimeType,
            appProperties: input.appProperties,
          }),
        },
      );
      if (!start.ok) {
        await input.body.cancel().catch(() => undefined);
        throw await failure('upload (inicio)', start);
      }
      // La URL de sesión permite subir sin token: no se registra ni se persiste.
      const sessionUrl = start.headers.get('location');
      if (!sessionUrl?.startsWith(`${UPLOAD_API}/`)) {
        await input.body.cancel().catch(() => undefined);
        throw new DriveBackupError('transient', 'Drive no devolvió una sesión de subida válida.');
      }
      // 2) Contenido por streaming, con el largo exacto declarado.
      const upload = await call('upload (contenido)', sessionUrl, {
        method: 'PUT',
        headers: { 'content-type': input.mimeType, 'content-length': String(input.sizeBytes) },
        body: input.body,
        duplex: 'half',
        timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      if (!upload.ok) throw await failure('upload (contenido)', upload);
      await upload.body?.cancel().catch(() => undefined);
    },

    async describeDestination(id) {
      // `drives.get` responde 200 solo si el ID es una unidad compartida.
      const drive = await call(
        'drives.get',
        `${API}/drives/${encodeURIComponent(id)}?${new URLSearchParams({
          fields: 'id,name,capabilities(canAddChildren,canListChildren,canDeleteChildren)',
        })}`,
      );
      if (drive.ok) {
        const raw = (await drive.json()) as Record<string, unknown>;
        const capabilities = (raw.capabilities ?? {}) as Record<string, unknown>;
        const flag = (name: string) =>
          typeof capabilities[name] === 'boolean' ? (capabilities[name] as boolean) : null;
        return {
          kind: 'shared_drive_root',
          id: String(raw.id),
          name: typeof raw.name === 'string' ? raw.name : '',
          driveId: String(raw.id),
          canAddChildren: flag('canAddChildren'),
          canListChildren: flag('canListChildren'),
          canDeleteChildren: flag('canDeleteChildren'),
        };
      }
      if (drive.status !== 404) throw await failure('drives.get', drive);
      const response = await call(
        'files.get (destino)',
        `${API}/files/${encodeURIComponent(id)}?${withDrives({
          fields:
            'id,name,mimeType,driveId,capabilities(canAddChildren,canListChildren,canDeleteChildren,canTrashChildren)',
        })}`,
      );
      if (!response.ok) throw await failure('files.get (destino)', response);
      const raw = (await response.json()) as Record<string, unknown>;
      const capabilities = (raw.capabilities ?? {}) as Record<string, unknown>;
      const flag = (name: string) =>
        typeof capabilities[name] === 'boolean' ? (capabilities[name] as boolean) : null;
      const driveId = typeof raw.driveId === 'string' ? raw.driveId : null;
      const isFolder = raw.mimeType === FOLDER_MIME;
      return {
        kind: isFolder && driveId === raw.id ? 'shared_drive_root' : isFolder ? 'folder' : 'other',
        id: String(raw.id),
        name: typeof raw.name === 'string' ? raw.name : '',
        driveId,
        canAddChildren: flag('canAddChildren'),
        canListChildren: flag('canListChildren'),
        canDeleteChildren: flag('canDeleteChildren'),
      };
    },
  };
}
