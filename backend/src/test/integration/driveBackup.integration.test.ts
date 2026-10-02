import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { setDriveBackupConfigForTests } from '../../driveBackup/config';
import { enqueueDriveBackup } from '../../driveBackup';
import { createPrismaDriveBackupStore } from '../../driveBackup/store';
import { prisma } from '../../lib/prisma';

/**
 * Cola de la copia en Drive contra Postgres real (`demo`, Etapa 5Z): el alta
 * vive o muere con la transacción de confirmación, el reclamo es exclusivo
 * entre trabajadores concurrentes (`SKIP LOCKED`), un reclamo vencido se
 * recupera, un token viejo no pisa el resultado y la carpeta tiene un único
 * ID aunque dos procesos la registren a la vez. Nunca habla con Google.
 *
 * Datos sintéticos (archivos con bucket y clave de prueba, sin objeto real) y
 * limpieza por ID exacto en `afterAll`.
 */

const store = createPrismaDriveBackupStore();
const fileIds: string[] = [];
const folderPaths: string[] = [];
const T0 = new Date('2026-10-02T12:00:00Z');
const LEASE = 10 * 60_000;

async function syntheticPhoto(): Promise<string> {
  const id = randomUUID();
  await prisma.fileAsset.create({
    data: {
      id,
      provider: 'NEON_OBJECT_STORAGE',
      bucket: 'integration-test-drive-backup',
      objectKey: `integration/drive-backup/${id}.jpg`,
      originalFilename: 'sintetica.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      category: 'MEMORY',
      status: 'AVAILABLE',
    },
  });
  fileIds.push(id);
  return id;
}

async function enqueued(fileAssetId: string) {
  await prisma.driveBackupJob.create({
    data: { fileAssetId, module: 'fotos', environment: 'DEMO', nextAttemptAt: T0 },
  });
}

const ours = (ids: string[]) => ({ fileAssetId: { in: ids } });

afterEach(() => setDriveBackupConfigForTests(undefined));

afterAll(async () => {
  await prisma.driveBackupJob.deleteMany({ where: ours(fileIds) });
  await prisma.driveBackupFolder.deleteMany({ where: { path: { in: folderPaths } } });
  await prisma.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
  expect(await prisma.driveBackupJob.count({ where: ours(fileIds) })).toBe(0);
  expect(await prisma.fileAsset.count({ where: { id: { in: fileIds } } })).toBe(0);
  await prisma.$disconnect();
});

describe('alta en la transacción de confirmación', () => {
  it('se confirma con la foto y desaparece si la transacción se revierte', async () => {
    setDriveBackupConfigForTests({
      destinationId: 'shared-drive-root-1',
      environment: 'DEMO',
      credentialsFile: '/no/se/lee.json',
    });
    const committed = await syntheticPhoto();
    await prisma.$transaction(async (tx) => {
      await enqueueDriveBackup(tx, committed, 'fotos');
    });
    expect(
      await prisma.driveBackupJob.findUnique({ where: { fileAssetId: committed } }),
    ).toMatchObject({ status: 'PENDING', environment: 'DEMO', module: 'fotos', attempts: 0 });

    const rolledBack = await syntheticPhoto();
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueDriveBackup(tx, rolledBack, 'mascotas');
        throw new Error('la confirmación falló');
      }),
    ).rejects.toThrow('la confirmación falló');
    expect(await prisma.driveBackupJob.count({ where: { fileAssetId: rolledBack } })).toBe(0);

    // Una sola copia por archivo, garantizado por la base.
    await expect(
      prisma.$transaction((tx) => enqueueDriveBackup(tx, committed, 'fotos')),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('desactivada: no crea nada', async () => {
    setDriveBackupConfigForTests(null);
    const id = await syntheticPhoto();
    expect(await prisma.$transaction((tx) => enqueueDriveBackup(tx, id, 'fotos'))).toBe(false);
    expect(await prisma.driveBackupJob.count({ where: { fileAssetId: id } })).toBe(0);
  });

  it('la base rechaza módulos desconocidos (el plano del Jardín no se copia)', async () => {
    const id = await syntheticPhoto();
    await expect(
      prisma.driveBackupJob.create({
        data: { fileAssetId: id, module: 'jardin', environment: 'DEMO' },
      }),
    ).rejects.toBeDefined();
  });
});

describe('reclamo atómico', () => {
  it('dos trabajadores concurrentes nunca toman el mismo trabajo', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, syntheticPhoto));
    for (const id of ids) await enqueued(id);

    const [a, b] = await Promise.all([
      store.claimDue('DEMO', T0, 4, LEASE),
      store.claimDue('DEMO', T0, 4, LEASE),
    ]);
    const claimed = [...a, ...b].filter((job) => ids.includes(job.fileAssetId));
    expect(new Set(claimed.map((job) => job.id)).size).toBe(claimed.length);
    expect(claimed.length).toBeGreaterThan(0);
    for (const job of claimed) expect(job).toMatchObject({ attempts: 1, remoteFileId: null });

    // Mientras el reclamo está vigente, nadie más los ve.
    const again = await store.claimDue('DEMO', T0, 50, LEASE);
    expect(again.some((job) => claimed.some((other) => other.id === job.id))).toBe(false);
    // Los que quedaron libres se cierran como pendientes para la próxima prueba.
    for (const job of [...claimed, ...again].filter((row) => ids.includes(row.fileAssetId))) {
      await store.finish(job, 'FAILED', { kind: 'test', message: 'cerrado por la prueba' });
    }
  });

  it('reclamo vencido (proceso caído): se recupera; el token viejo ya no puede cerrar', async () => {
    const id = await syntheticPhoto();
    await enqueued(id);
    const [orphan] = (await store.claimDue('DEMO', T0, 50, LEASE)).filter(
      (job) => job.fileAssetId === id,
    );
    expect(orphan).toBeDefined();
    expect(await store.saveRemoteFileId(orphan!, `remote-${id}`)).toBe(true);

    const later = new Date(T0.getTime() + LEASE);
    const [recovered] = (await store.claimDue('DEMO', later, 50, LEASE)).filter(
      (job) => job.fileAssetId === id,
    );
    // Conserva el ID remoto reservado: el reintento verificará antes de subir.
    expect(recovered).toMatchObject({ attempts: 2, remoteFileId: `remote-${id}` });
    expect(recovered!.claimToken).not.toBe(orphan!.claimToken);

    expect(await store.complete(orphan!, `remote-${id}`, null, later)).toBe(false);
    expect(await store.complete(recovered!, `remote-${id}`, 'folder-x', later)).toBe(true);
    expect(await prisma.driveBackupJob.findUnique({ where: { fileAssetId: id } })).toMatchObject({
      status: 'COMPLETED',
      remoteFileId: `remote-${id}`,
      claimToken: null,
    });
  });

  it('reprogramar libera el reclamo y fija el próximo intento; nextWakeAt lo informa', async () => {
    const id = await syntheticPhoto();
    await enqueued(id);
    const [job] = (await store.claimDue('DEMO', T0, 50, LEASE)).filter(
      (row) => row.fileAssetId === id,
    );
    const next = new Date(T0.getTime() + 60_000);
    expect(await store.reschedule(job!, next, { kind: 'transient', message: 'HTTP 503' })).toBe(
      true,
    );
    expect(await prisma.driveBackupJob.findUnique({ where: { fileAssetId: id } })).toMatchObject({
      status: 'PENDING',
      claimToken: null,
      lastErrorKind: 'transient',
      nextAttemptAt: next,
    });
    const wake = await store.nextWakeAt('DEMO');
    expect(wake).not.toBeNull();
    expect(wake!.getTime()).toBeLessThanOrEqual(next.getTime());
    expect(await store.claimDue('PRODUCTION', new Date(next.getTime() + 1), 50, LEASE)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ fileAssetId: id })]),
    );
    await prisma.driveBackupJob.update({
      where: { fileAssetId: id },
      data: { status: 'FAILED' },
    });
  });
});

describe('carpetas', () => {
  it('dos procesos que registran la misma ruta a la vez obtienen el mismo ID', async () => {
    const path = `integration-test/${randomUUID()}`;
    folderPaths.push(path);
    const [a, b] = await Promise.all([
      store.insertFolderIfAbsent(path, `folder-a-${randomUUID()}`),
      store.insertFolderIfAbsent(path, `folder-b-${randomUUID()}`),
    ]);
    expect(a).toBe(b);
    expect(await store.getFolder(path)).toBe(a);
  });
});
