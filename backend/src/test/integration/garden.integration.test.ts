import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import pg from 'pg';
import { createApp } from '../../app';
import { prisma } from '../../lib/prisma';
import { accessTokenSecret } from '../../auth/config';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../../auth/tokens';
import { setObjectStorageForTests, type ObjectStorageClient } from '../../lib/objectStorage';

/**
 * 🌳 Jardín (Etapa 5Y) contra Neon real (`demo`) por HTTP real. Lo que se
 * prueba acá es lo que un mock NO puede probar: los invariantes que viven en
 * Postgres.
 *  - todo lo creado es sintético: los usuarios y el empleado llevan
 *    `test-5y-<RUN>` y los archivos se reconocen por su `checksum` (los bytes
 *    sintéticos incluyen el RUN). El test NUNCA borra ni altera una versión real:
 *    solo crea las suyas y al terminar verifica 0 residuos y conteos globales
 *    idénticos a los del inicio, así que puede correr aunque el ADMIN ya haya
 *    publicado planos de verdad (los números de versión se leen de la base, no
 *    se asumen);
 *  - el almacenamiento es EN MEMORIA (nunca el bucket real);
 *  - `afterAll` borra solo lo creado (por id o por checksum) y verifica 0
 *    residuos y conteos globales idénticos a los iniciales.
 */

/** Prefijo de TODO lo que crea este archivo: nunca puede ser un dato real. */
const RUN_PREFIX = 'test-5y-';
const RUN = `${RUN_PREFIX}${Date.now()}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(RUN)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(RUN),
]);

interface Actor {
  userId: string;
  token: string;
}

let app: Express;
let admin: Actor;
let employee: Actor;
const userIds: string[] = [];
const employeeIds: string[] = [];
/** Claves de idempotencia enviadas por este RUN: se limpian por valor exacto. */
const idempotencyKeys: string[] = [];
/** Conteos globales: el `afterAll` exige volver exactamente a estos números. */
interface Counts {
  versions: number;
  /** Número de versión más alto al empezar: el siguiente es este + 1. */
  maxVersion: number;
  files: number;
  idempotency: number;
  users: number;
  employees: number;
}
let baseline: Counts;

/** Checksums de los buffers sintéticos: con ellos se limpian TODOS los archivos del RUN. */
const syntheticChecksums = [JPEG, PNG].map((buffer) =>
  createHash('sha256').update(buffer).digest('hex'),
);

const objects = new Map<string, Buffer>();
/** Object keys que este RUN subió al bucket: se registran al crearse, no se buscan después. */
const trackedObjectKeys = new Set<string>();
const memoryStorage: ObjectStorageClient = {
  bucket: 'memoria-test',
  async putObject(key, body) {
    objects.set(key, body);
    trackedObjectKeys.add(key);
    return { etag: '"memoria"' };
  },
  async getObject(key) {
    const body = objects.get(key);
    return body ? { body, contentType: null, etag: null } : null;
  },
  async deleteObject(key) {
    objects.delete(key);
  },
};

/**
 * Registro de TODO lo que crea el RUN, por ID exacto. La limpieza borra solo
 * estas listas: nunca por `MAX(version_number)`, ni por conteo global, ni por
 * un rango de fechas que pudiera incluir datos reales.
 */
const tracked = {
  versionIds: new Set<string>(),
  fileIds: new Set<string>(),
  objectKeys: trackedObjectKeys,
  userIds: new Set<string>(),
  sessionIds: new Set<string>(),
  employeeIds: new Set<string>(),
};

/** Registra la versión creada por una respuesta 201 y su fila de archivo, por ID. */
async function track(response: { body: { version?: { id?: string } } }): Promise<void> {
  const versionId = response.body?.version?.id;
  if (versionId) tracked.versionIds.add(versionId);
  // El `objectKey` lo genera el servicio: se localiza la fila EXACTA por esa
  // clave (recién subida por este RUN), sin adivinar por fecha ni por checksum.
  if (trackedObjectKeys.size > 0) {
    const files = await prisma.fileAsset.findMany({
      where: { category: 'GARDEN_PLAN', objectKey: { in: [...trackedObjectKeys] } },
      select: { id: true },
    });
    for (const file of files) tracked.fileIds.add(file.id);
  }
}

type QueryFn = (...args: unknown[]) => unknown;
const originalQuery = pg.Client.prototype.query as unknown as QueryFn;
const statements: string[] = [];
let counting = false;

async function countStatements<T>(run: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  statements.length = 0;
  counting = true;
  try {
    const result = await run();
    return { result, sql: statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) };
  } finally {
    counting = false;
  }
}

async function globalCounts(): Promise<Counts> {
  const highest = await prisma.gardenPlanVersion.aggregate({ _max: { versionNumber: true } });
  return {
    versions: await prisma.gardenPlanVersion.count(),
    maxVersion: highest._max.versionNumber ?? 0,
    files: await prisma.fileAsset.count(),
    idempotency: await prisma.idempotencyRecord.count(),
    users: await prisma.user.count(),
    employees: await prisma.employee.count(),
  };
}

async function createActor(role: 'ADMIN' | 'EMPLOYEE', suffix: string, linked?: string) {
  const user = await prisma.user.create({
    data: {
      username: `${RUN}-${suffix}`,
      role,
      status: 'ACTIVE',
      pinHash: 'synthetic-not-a-real-hash',
      employeeId: linked,
    },
    select: { id: true },
  });
  userIds.push(user.id);
  tracked.userIds.add(user.id);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hashRefreshToken(generateRefreshToken()),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
    select: { id: true },
  });
  tracked.sessionIds.add(session.id);
  const token = await signAccessToken(
    { userId: user.id, sessionId: session.id, role },
    accessTokenSecret,
    3600,
  );
  return { userId: user.id, token };
}

const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });
const key = () => crypto.randomUUID().replace(/-/g, '');
const api = '/api/v1/more/garden';

async function publish(actor: Actor, body: Buffer, type = 'image/jpeg', idempotencyKey?: string) {
  const call = request(app)
    .post(`${api}/versions`)
    .set(as(actor))
    .set('Content-Type', type)
    .set('X-File-Name', 'plano-sintetico.jpg');
  if (idempotencyKey) idempotencyKeys.push(idempotencyKey);
  const response = await (idempotencyKey ? call.set('Idempotency-Key', idempotencyKey) : call).send(
    body,
  );
  await track(response);
  return response;
}

beforeAll(async () => {
  baseline = await globalCounts();
  app = createApp();
  const emp = await prisma.employee.create({
    data: {
      code: `${RUN}-emp`,
      displayName: `Sintético ${RUN}`,
      role: 'Test',
      colorHex: '#4a7c59',
    },
    select: { id: true },
  });
  employeeIds.push(emp.id);
  tracked.employeeIds.add(emp.id);
  admin = await createActor('ADMIN', 'admin');
  employee = await createActor('EMPLOYEE', 'emp', emp.id);
  setObjectStorageForTests(memoryStorage);
  (pg.Client.prototype as unknown as { query: QueryFn }).query = function (
    this: unknown,
    ...args: unknown[]
  ) {
    if (counting) {
      const text =
        typeof args[0] === 'string' ? args[0] : ((args[0] as { text?: string })?.text ?? '');
      const flat = text.trim().replace(/\s+/g, ' ');
      statements.push(`${flat.slice(0, 40)} … ${flat.match(/FROM "([a-z_]+)"/)?.[1] ?? '?'}`);
    }
    return originalQuery.apply(this, args);
  };
}, 60_000);

afterAll(async () => {
  (pg.Client.prototype as unknown as { query: QueryFn }).query = originalQuery;
  setObjectStorageForTests(undefined);

  // Red de seguridad: si algún test falló antes de registrar, el prefijo del
  // RUN y los checksums de los bytes sintéticos (que lo llevan embebido) siguen
  // siendo pruebas de origen. `MAX(version_number)` NO decide qué borrar: solo
  // se usó para calcular los números esperados en las aserciones.
  const orphans = await prisma.gardenPlanVersion.findMany({
    where: { publishedBy: { username: { startsWith: RUN } } },
    select: { id: true, fileAssetId: true },
  });
  for (const row of orphans) {
    tracked.versionIds.add(row.id);
    tracked.fileIds.add(row.fileAssetId);
  }
  const filesByChecksum = await prisma.fileAsset.findMany({
    where: { checksum: { in: syntheticChecksums } },
    select: { id: true, objectKey: true },
  });
  for (const file of filesByChecksum) {
    tracked.fileIds.add(file.id);
    tracked.objectKeys.add(file.objectKey);
  }

  const versionIds = [...tracked.versionIds];
  const fileIds = [...tracked.fileIds];
  const userIds = [...tracked.userIds];
  const sessionIds = [...tracked.sessionIds];
  const employeeIds = [...tracked.employeeIds];

  // Orden seguro: primero lo que cuelga de las versiones, después las versiones,
  // y por último las personas del RUN.
  await prisma.idempotencyRecord.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { key: { in: idempotencyKeys } }] },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { entityId: { in: [...versionIds, ...fileIds, ...employeeIds] } },
      ],
    },
  });
  await prisma.gardenPlanVersion.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
  await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });

  // Bucket: se borra cada clave registrada y se comprueba que ya no existe. La
  // versión anterior hacía `objects.clear()` y luego afirmaba `size === 0`: una
  // aserción que NUNCA podía fallar, y por eso no detectaba objetos huérfanos.
  for (const key of tracked.objectKeys) await memoryStorage.deleteObject(key);
  const remainingObjects = [...objects.keys()];
  expect(
    remainingObjects,
    `el bucket de pruebas conservó objetos del RUN: ${remainingObjects.join(', ')}`,
  ).toEqual([]);

  // ── Barrido de residuos: si queda UNO de este RUN, la suite falla ────────
  const residues = {
    versiones: await prisma.gardenPlanVersion.count({
      where: { id: { in: versionIds } },
    }),
    archivos: await prisma.fileAsset.count({ where: { id: { in: fileIds } } }),
    archivosPorChecksum: await prisma.fileAsset.count({
      where: { checksum: { in: syntheticChecksums } },
    }),
    auditorias: await prisma.auditLog.count({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { entityId: { in: [...versionIds, ...fileIds, ...employeeIds] } },
        ],
      },
    }),
    idempotencia: await prisma.idempotencyRecord.count({
      where: { OR: [{ actorUserId: { in: userIds } }, { key: { in: idempotencyKeys } }] },
    }),
    sesiones: await prisma.session.count({ where: { id: { in: sessionIds } } }),
    usuarios: await prisma.user.count({ where: { id: { in: userIds } } }),
    empleados: await prisma.employee.count({ where: { id: { in: employeeIds } } }),
    usuariosPorPrefijo: await prisma.user.count({
      where: { username: { startsWith: `${RUN_PREFIX}` } },
    }),
    empleadosPorPrefijo: await prisma.employee.count({
      where: { code: { startsWith: `${RUN_PREFIX}` } },
    }),
  };
  expect(residues, 'quedó un residuo sintético del RUN').toEqual({
    versiones: 0,
    archivos: 0,
    archivosPorChecksum: 0,
    auditorias: 0,
    idempotencia: 0,
    sesiones: 0,
    usuarios: 0,
    empleados: 0,
    usuariosPorPrefijo: 0,
    empleadosPorPrefijo: 0,
  });

  // Conteos globales: para las personas del RUN la igualdad es exacta (la app
  // real no crea usuarios). Para versiones y archivos se exige que no haya
  // BAJADO del baseline: si el ADMIN real publica durante la corrida, el conteo
  // sube y eso no es un residuo de este test.
  const after = await globalCounts();
  expect(after.versions).toBeGreaterThanOrEqual(baseline.versions);
  expect(after.files).toBeGreaterThanOrEqual(baseline.files);
  expect(after.idempotency).toBeGreaterThanOrEqual(baseline.idempotency);
  expect(after.users).toBe(baseline.users);
  expect(after.employees).toBe(baseline.employees);
}, 60_000);

describe('🌳 Jardín — permisos y estado inicial', () => {
  it('el historial inicial refleja exactamente lo que hay, sin inventar ni filtrar filas', async () => {
    const response = await request(app).get(`${api}/versions`).set(as(employee));
    expect(response.status).toBe(200);
    // Nadie publicó nada desde este test todavía: lo que hay es lo real.
    expect(response.body.total).toBe(baseline.versions);
    expect(response.body.totalPages).toBe(Math.max(1, Math.ceil(baseline.versions / 20)));
    expect(response.body.versions).toHaveLength(Math.min(baseline.versions, 20));
    expect(response.body.gardenStorage).toBe('configured');
    // `current` es la de número más alto; si el módulo está vacío, `null`.
    if (baseline.versions === 0) {
      expect(response.body.current).toBeNull();
      expect(response.body.versions).toEqual([]);
    } else {
      expect(response.body.current.versionNumber).toBe(baseline.maxVersion);
      expect(response.body.versions[0].id).toBe(response.body.current.id);
    }
  });

  it('EMPLOYEE ve el mismo plano que ADMIN, pero no puede publicar (403)', async () => {
    const denied = await publish(employee, JPEG);
    expect(denied.status).toBe(403);
    // Ni una fila ni una subida: el permiso se corta antes de tocar el bucket.
    expect(await prisma.gardenPlanVersion.count()).toBe(baseline.versions);
    expect(await prisma.fileAsset.count()).toBe(baseline.files);
    expect(objects.size).toBe(0);
  });

  it('el tipo sale de los bytes: un PNG declarado JPEG o un SVG se rechazan con 415', async () => {
    expect((await publish(admin, JPEG, 'image/png')).status).toBe(415);
    expect((await publish(admin, Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(415);
    expect(await prisma.fileAsset.count()).toBe(baseline.files);
  });
});

describe('🌳 Jardín — publicación e historial', () => {
  it('ADMIN publica v1, la vigente es la última y el historial es paginado', async () => {
    const first = await publish(admin, JPEG);
    const second = await publish(admin, PNG, 'image/png');
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.version.versionNumber).toBe(baseline.maxVersion + 1);
    expect(second.body.version.versionNumber).toBe(baseline.maxVersion + 2);
    // El ADMIN de este test no tiene empleado: se muestra su username, nunca su id.
    expect(first.body.version.publishedBy).toBe(`${RUN}-admin`);
    expect(first.body.version).not.toHaveProperty('fileAssetId');
    expect(first.body.version).not.toHaveProperty('objectKey');
    expect(first.body.version).not.toHaveProperty('publishedByUserId');

    const history = await request(app).get(`${api}/versions?pageSize=1`).set(as(employee));
    expect(history.status).toBe(200);
    expect(history.body.total).toBe(baseline.versions + 2);
    expect(history.body.totalPages).toBe(baseline.versions + 2);
    expect(history.body.current.versionNumber).toBe(2);
    expect(history.body.versions).toHaveLength(1);
    const page2 = await request(app).get(`${api}/versions?page=2&pageSize=1`).set(as(employee));
    expect(page2.body.versions[0].versionNumber).toBe(baseline.maxVersion + 1);
    expect(page2.body.current).toBeNull();
  });

  it('dos publicaciones simultáneas se serializan: números distintos, nunca un 500', async () => {
    const [a, b] = await Promise.all([publish(admin, JPEG), publish(admin, PNG, 'image/png')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const numbers = [a.body.version.versionNumber, b.body.version.versionNumber].sort(
      (x, y) => x - y,
    );
    expect(numbers[1] - numbers[0]).toBe(1);
  });

  it('el bucket y la clave nunca salen: el contenido se sirve por proxy con ETag y 304', async () => {
    const created = await publish(admin, JPEG);
    const versionId = created.body.version.id as string;
    const content = await request(app)
      .get(`${api}/versions/${versionId}/content`)
      .set(as(employee));
    expect(content.status).toBe(200);
    expect(content.headers['content-type']).toContain('image/jpeg');
    expect(content.headers['cache-control']).toBe('private, max-age=86400, immutable');
    const etag = content.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(content.body).toEqual(JPEG);

    const cached = await request(app)
      .get(`${api}/versions/${versionId}/content`)
      .set('If-None-Match', etag)
      .set(as(employee));
    expect(cached.status).toBe(304);

    const missing = await request(app)
      .get(`${api}/versions/00000000-0000-4000-8000-000000000000/content`)
      .set(as(employee));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('GARDEN_PLAN_VERSION_NOT_FOUND');
  });

  it('replay con la misma clave e imagen: una sola versión y una sola subida', async () => {
    const idem = key();
    const gardenFiles = {
      category: 'GARDEN_PLAN' as const,
      objectKey: { startsWith: 'garden-plans/' },
    };
    const availableBefore = await prisma.fileAsset.count({
      where: { ...gardenFiles, status: 'AVAILABLE' },
    });
    const objectsBefore = objects.size;
    const first = await publish(admin, JPEG, 'image/jpeg', idem);
    const replay = await publish(admin, JPEG, 'image/jpeg', idem);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.body.version.id).toBe(first.body.version.id);
    expect(
      await prisma.gardenPlanVersion.findMany({ where: { id: first.body.version.id } }),
    ).toHaveLength(1);
    // Reenviar la MISMA clave con la misma imagen no vuelve a subir nada: una
    // sola fila AVAILABLE y un solo objeto en el bucket.
    expect(await prisma.fileAsset.count({ where: { ...gardenFiles, status: 'AVAILABLE' } })).toBe(
      availableBefore + 1,
    );
    expect(objects.size).toBe(objectsBefore + 1);
    const conflict = await publish(admin, PNG, 'image/png', idem);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('dos envíos simultáneos con la misma clave: una sola versión y el objeto perdedor se descarta', async () => {
    const idem = key();
    const gardenFiles = {
      category: 'GARDEN_PLAN' as const,
      objectKey: { startsWith: 'garden-plans/' },
    };
    const availableBefore = await prisma.fileAsset.count({
      where: { ...gardenFiles, status: 'AVAILABLE' },
    });
    const objectsBefore = objects.size;
    const [a, b] = await Promise.all([
      publish(admin, JPEG, 'image/jpeg', idem),
      publish(admin, JPEG, 'image/jpeg', idem),
    ]);
    // El ganador crea; el perdedor o bien repite el resultado (replay) o bien
    // responde que la anterior sigue en curso. Nunca dos versiones.
    expect(a.status).toBe(201);
    expect([201, 409]).toContain(b.status);
    if (b.status === 201) expect(b.body.version.id).toBe(a.body.version.id);
    else expect(b.body.error.code).toBe('IDEMPOTENCY_RECORD_PENDING');
    expect(
      await prisma.gardenPlanVersion.count({
        where: { fileAsset: { checksum: syntheticChecksums[0] } },
        // solo las de este actor: el checksum es compartido con otros tests
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(await prisma.fileAsset.count({ where: { ...gardenFiles, status: 'AVAILABLE' } })).toBe(
      availableBefore + 1,
    );
    // El objeto del perdedor se borró del bucket: queda netamente uno.
    expect(objects.size).toBe(objectsBefore + 1);
    // Su fila existe con baja lógica y SIN versión: nunca entra al historial.
    const discarded = await prisma.fileAsset.findMany({
      where: { ...gardenFiles, status: { in: ['DELETED', 'PENDING_DELETION'] } },
      select: { id: true, gardenPlanVersion: { select: { id: true } } },
    });
    expect(discarded.length).toBeGreaterThan(0);
    expect(discarded.every((file) => file.gardenPlanVersion === null)).toBe(true);
  });

  it('abrir Jardín cuesta un número FIJO de consultas: sin N+1 ni lectura del plano', async () => {
    // 2 del login (autenticación) + 5 del módulo, que no crecen con la cantidad
    // de versiones: se mide con una página de 1 y con una de 20.
    const moduleQueries = (list: string[]) =>
      list.filter((sql) => !sql.startsWith('SELECT s."id"'));
    const one = await countStatements(() =>
      request(app).get(`${api}/versions?pageSize=1`).set(as(employee)),
    );
    const many = await countStatements(() =>
      request(app).get(`${api}/versions?pageSize=20`).set(as(employee)),
    );
    expect(one.result.status).toBe(200);
    expect(many.result.status).toBe(200);
    expect(one.result.body.versions).toHaveLength(1);
    // Con pageSize 20 entra todo el historial de este RUN en una sola página.
    expect(many.result.body.versions).toHaveLength(many.result.body.total);
    expect(moduleQueries(one.sql).length).toBe(5);
    expect(moduleQueries(many.sql)).toEqual(moduleQueries(one.sql));
    // El conteo, la página y sus tres relaciones (archivo, autor, empleado):
    // ninguna consulta por versión.
    expect(moduleQueries(many.sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('COUNT'),
        expect.stringContaining('garden_plan_versions'),
        expect.stringContaining('file_assets'),
        expect.stringContaining('users'),
        expect.stringContaining('employees'),
      ]),
    );
  });
});

describe('🌳 Jardín — los invariantes viven en Postgres', () => {
  it('`version_number` es único en la base: duplicarlo a mano se rechaza', async () => {
    const created = await publish(admin, JPEG);
    const versionId = created.body.version.id as string;
    const row = await prisma.gardenPlanVersion.findUniqueOrThrow({ where: { id: versionId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "garden_plan_versions" ("id","version_number","file_asset_id","published_by_user_id","created_at") VALUES (gen_random_uuid(), ${row.versionNumber}, ${row.fileAssetId}, ${row.publishedByUserId}::uuid, now())`;
      }),
    ).rejects.toThrow(/garden_plan_versions_version_number_key/);
  });

  it('`file_asset_id` es único: dos versiones no comparten el mismo archivo', async () => {
    const created = await publish(admin, JPEG);
    const row = await prisma.gardenPlanVersion.findUniqueOrThrow({
      where: { id: created.body.version.id as string },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "garden_plan_versions" ("id","version_number","file_asset_id","published_by_user_id","created_at") VALUES (gen_random_uuid(), ${row.versionNumber + 1000}, ${row.fileAssetId}, ${row.publishedByUserId}::uuid, now())`;
      }),
    ).rejects.toThrow(/garden_plan_versions_file_asset_id_key/);
  });

  it('las FK son RESTRICT: ni el archivo ni quien publicó se pueden borrar con versiones vivas', async () => {
    const created = await publish(admin, JPEG);
    const row = await prisma.gardenPlanVersion.findUniqueOrThrow({
      where: { id: created.body.version.id as string },
    });
    await expect(prisma.fileAsset.delete({ where: { id: row.fileAssetId } })).rejects.toThrow(
      /garden_plan_versions_file_asset_id_fkey/,
    );
    await expect(prisma.user.delete({ where: { id: row.publishedByUserId } })).rejects.toThrow(
      /garden_plan_versions_published_by_user_id_fkey/,
    );
    expect(await prisma.gardenPlanVersion.count({ where: { id: row.id } })).toBe(1);
  });
});
