import { describe, expect, it, vi } from 'vitest';
import type { DriveBackupConfig } from '../../driveBackup/config';
import { DriveBackupError } from '../../driveBackup/errors';
import {
  backoffDelayMs,
  backupFileName,
  createDriveBackupScheduler,
  createDriveBackupWorker,
  DRIVE_BACKUP_LIMITS,
  folderSegments,
  type SourceReader,
} from '../../driveBackup/worker';
import { fakeDrive, memoryStore, streamOf } from './fakes';

/**
 * Trabajador de la copia en Drive (Etapa 5Z) con dobles en memoria: retoma
 * tras reinicios, exclusión por reclamo, respuesta perdida sin duplicar,
 * backoff/clasificación, separación demo/production y la carrera con la
 * eliminación en la app.
 */

const TZ = 'America/Argentina/Buenos_Aires';
const DEMO: DriveBackupConfig = {
  destinationId: 'shared-drive-root-1',
  environment: 'DEMO',
  credentialsFile: '/fuera/del/repo/credenciales.json',
};
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const T0 = new Date('2026-10-02T12:00:00Z');

function setup(options: { config?: DriveBackupConfig; readSource?: SourceReader } = {}) {
  const memory = memoryStore();
  const drive = fakeDrive();
  let clock = T0;
  const readSource = vi.fn<SourceReader>(
    options.readSource ?? (async () => ({ body: streamOf(PHOTO), contentLength: PHOTO.length })),
  );
  const make = () =>
    createDriveBackupWorker({
      config: options.config ?? DEMO,
      store: memory.store,
      drive: drive.client,
      readSource,
      businessTimeZone: TZ,
      now: () => clock,
      random: () => 0.5,
      log: () => undefined,
    });
  return {
    ...memory,
    drive,
    readSource,
    make,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('organización, nombres y backoff (funciones puras)', () => {
  it('carpetas: entorno / módulo / año / mes según la zona del negocio, no UTC', () => {
    // 02:30 UTC del 1/10 = 23:30 del 30/09 en Buenos Aires.
    const instant = new Date('2026-10-01T02:30:00Z');
    expect(folderSegments('DEMO', 'fotos', instant, TZ)).toEqual(['demo', 'fotos', '2026', '09']);
    expect(folderSegments('PRODUCTION', 'mascotas', instant, TZ)).toEqual([
      'production',
      'mascotas',
      '2026',
      '09',
    ]);
  });

  it('nombre legible, con ID estable y sin datos personales ni título', () => {
    const name = backupFileName(
      '11111111-1111-4111-8111-111111111111',
      {
        status: 'AVAILABLE',
        objectKey: 'memories/2026/x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4,
        category: 'MEMORY',
        createdAt: new Date('2026-10-01T02:30:00Z'),
      },
      TZ,
    );
    expect(name).toBe('2026-09-30_recuerdo_11111111-1111-4111-8111-111111111111.jpg');
  });

  it('backoff exponencial acotado para errores temporales; espaciado fijo para configuración', () => {
    const mid = () => 0.5; // sin jitter
    expect(backoffDelayMs('transient', 1, mid)).toBe(60_000);
    expect(backoffDelayMs('transient', 2, mid)).toBe(120_000);
    expect(backoffDelayMs('transient', 4, mid)).toBe(480_000);
    expect(backoffDelayMs('transient', 30, mid)).toBe(DRIVE_BACKUP_LIMITS.maxBackoffMs);
    expect(backoffDelayMs('config', 1, mid)).toBe(DRIVE_BACKUP_LIMITS.configBackoffMs);
    expect(backoffDelayMs('transient', 1, () => 0)).toBe(48_000);
    expect(backoffDelayMs('transient', 1, () => 1)).toBe(72_000);
  });
});

describe('procesamiento', () => {
  it('copia una foto confirmada en demo/fotos/<año>/<mes> con su marca de la app', async () => {
    const env = setup();
    const job = env.addPhoto();
    await env.make().runBatch();

    const row = env.jobs.get(job.id)!;
    expect(row.status).toBe('COMPLETED');
    const [copy] = env.drive.uploadedPhotos();
    expect(copy).toMatchObject({
      id: row.remoteFileId,
      bytes: PHOTO.length,
      appProperties: { laCanadaFileAssetId: job.fileAssetId, laCanadaEnv: 'demo' },
    });
    expect(env.drive.folderPaths()).toEqual([
      'demo',
      'demo/fotos',
      'demo/fotos/2026',
      'demo/fotos/2026/09',
    ]);
    expect(copy!.parents).toEqual([env.folders.get('demo/fotos/2026/09')]);
  });

  it('reutiliza las carpetas: diez fotos del mismo mes crean cuatro carpetas, no cuarenta', async () => {
    const env = setup();
    for (let index = 0; index < 10; index += 1) env.addPhoto();
    const worker = env.make();
    await worker.runBatch();
    await worker.runBatch();
    expect(env.drive.uploadedPhotos()).toHaveLength(10);
    expect(env.drive.folderPaths()).toHaveLength(4);
    // Otro proceso (caché vacía) tampoco duplica: toma los IDs de la base.
    env.addPhoto();
    await env.make().runBatch();
    expect(env.drive.folderPaths()).toHaveLength(4);
  });

  it('dos trabajadores que crean la misma carpeta a la vez coinciden en un único ID', async () => {
    const env = setup();
    const [a, b] = [env.make(), env.make()];
    const [first, second] = await Promise.all([
      a.ensureFolder(['demo', 'fotos', '2026', '10']),
      b.ensureFolder(['demo', 'fotos', '2026', '10']),
    ]);
    expect(first).toBe(second);
    expect(env.drive.folderPaths()).toHaveLength(4);
  });

  it('si la base perdió la fila de una carpeta, reutiliza la existente en Drive (por su marca)', async () => {
    const env = setup();
    await env.make().ensureFolder(['demo', 'fotos']);
    env.folders.clear();
    await env.make().ensureFolder(['demo', 'fotos']);
    expect(env.drive.folderPaths()).toEqual(['demo', 'demo/fotos']);
  });
});

describe('integración desactivada / entorno', () => {
  it('cada entorno solo procesa sus trabajos y escribe en su carpeta', async () => {
    const env = setup();
    const demoJob = env.addPhoto({ environment: 'DEMO' });
    const prodJob = env.addPhoto({ environment: 'PRODUCTION', module: 'mascotas' });

    await env.make().runBatch();
    expect(env.jobs.get(demoJob.id)!.status).toBe('COMPLETED');
    expect(env.jobs.get(prodJob.id)!.status).toBe('PENDING');
    expect(env.drive.folderPaths().every((path) => path?.startsWith('demo'))).toBe(true);

    const prod = createDriveBackupWorker({
      config: { ...DEMO, environment: 'PRODUCTION' },
      store: env.store,
      drive: env.drive.client,
      readSource: env.readSource,
      businessTimeZone: TZ,
      now: () => T0,
      log: () => undefined,
    });
    await prod.runBatch();
    expect(env.jobs.get(prodJob.id)!.status).toBe('COMPLETED');
    expect(env.drive.folderPaths()).toContain('production/mascotas/2026/09');
  });
});

describe('duplicados y reinicios', () => {
  it('respuesta perdida: el reintento encuentra la copia por su ID reservado y no vuelve a subir', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.drive.loseNextUploadResponse();

    await env.make().runBatch();
    const afterFirst = env.jobs.get(job.id)!;
    expect(afterFirst.status).toBe('PENDING'); // para la app, el intento falló
    expect(afterFirst.lastErrorKind).toBe('transient');
    expect(afterFirst.remoteFileId).not.toBeNull(); // pero el ID ya estaba reservado
    expect(env.drive.uploadedPhotos()).toHaveLength(1); // y la copia sí llegó

    env.advance(afterFirst.nextAttemptAt.getTime() - T0.getTime());
    await env.make().runBatch(); // proceso nuevo, tras un "reinicio"
    expect(env.jobs.get(job.id)!.status).toBe('COMPLETED');
    expect(env.jobs.get(job.id)!.remoteFileId).toBe(afterFirst.remoteFileId);
    expect(env.drive.uploadedPhotos()).toHaveLength(1);
    expect(env.readSource).toHaveBeenCalledTimes(1);
  });

  it('carrera con el mismo ID: Drive responde 409 y se cierra tras comprobar que es esta copia', async () => {
    const env = setup();
    const job = env.addPhoto();
    const worker = env.make();
    const [claimed] = await env.store.claimDue('DEMO', T0, 1, DRIVE_BACKUP_LIMITS.leaseMs);
    // La copia con ese ID ya existe en Drive (p. ej. la subió un reclamo
    // anterior cuya respuesta se perdió) cuando este trabajador entra a subir.
    env.drive.files.set('generated-id-9999', {
      id: 'generated-id-9999',
      name: 'x',
      mimeType: 'image/jpeg',
      parents: [],
      trashed: false,
      size: 4,
      appProperties: { laCanadaFileAssetId: job.fileAssetId },
      driveId: 'shared-drive-root-1',
      bytes: 4,
    });
    await worker.ensureFolder(['demo', 'fotos', '2026', '09']); // carpetas ya existentes
    vi.spyOn(env.drive.client, 'generateId').mockResolvedValueOnce('generated-id-9999');
    await worker.processJob(claimed!);
    expect(env.jobs.get(job.id)!.status).toBe('COMPLETED');
    expect(env.drive.uploadedPhotos()).toHaveLength(1);
  });

  it('proceso caído a mitad de la copia: al vencer el reclamo otro trabajador lo retoma', async () => {
    const env = setup();
    const job = env.addPhoto();
    // Un proceso reclamó y "murió" (no cierra nunca).
    const [orphan] = await env.store.claimDue('DEMO', T0, 5, DRIVE_BACKUP_LIMITS.leaseMs);
    expect(orphan).toBeDefined();
    expect(await env.make().runBatch()).toBe(0); // vigente: nadie más lo toma

    env.advance(DRIVE_BACKUP_LIMITS.leaseMs);
    expect(await env.make().runBatch()).toBe(1);
    expect(env.jobs.get(job.id)!).toMatchObject({ status: 'COMPLETED', attempts: 2 });
    // El trabajador caído ya no puede pisar el resultado con su token viejo.
    expect(await env.store.reschedule(orphan!, T0, { kind: 'transient', message: 'x' })).toBe(
      false,
    );
    expect(env.jobs.get(job.id)!.status).toBe('COMPLETED');
  });

  it('exclusión: dos trabajadores a la vez nunca toman el mismo trabajo', async () => {
    const env = setup();
    for (let index = 0; index < 8; index += 1) env.addPhoto();
    const [a, b] = await Promise.all([
      env.store.claimDue('DEMO', T0, 5, DRIVE_BACKUP_LIMITS.leaseMs),
      env.store.claimDue('DEMO', T0, 5, DRIVE_BACKUP_LIMITS.leaseMs),
    ]);
    const ids = [...a, ...b].map((job) => job.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(8);
  });
});

describe('errores', () => {
  it('error temporal: se reprograma con backoff y el mensaje queda saneado', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.drive.failNext(
      'uploadFile',
      new Error('fetch failed https://www.googleapis.com/upload?upload_id=SECRETO'),
    );
    await env.make().runBatch();
    const row = env.jobs.get(job.id)!;
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastErrorKind: 'transient' });
    expect(row.nextAttemptAt.getTime() - T0.getTime()).toBe(60_000);
    expect(row.lastErrorMessage).not.toMatch(/upload_id|SECRETO|https?:/);
  });

  it('permisos o credenciales: se reintenta espaciado, sin perder el trabajo', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.drive.failNext(
      'getFile',
      new DriveBackupError(
        'config',
        'Drive files.get respondió HTTP 403 (insufficientFilePermissions).',
        403,
      ),
    );
    await env.make().runBatch();
    const row = env.jobs.get(job.id)!;
    expect(row).toMatchObject({ status: 'PENDING', lastErrorKind: 'config' });
    expect(row.nextAttemptAt.getTime() - T0.getTime()).toBe(DRIVE_BACKUP_LIMITS.configBackoffMs);
  });

  it('solicitud inválida (400): falla definitiva, sin reintentos', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.drive.failNext(
      'uploadFile',
      new DriveBackupError('invalid', 'Drive respondió HTTP 400.', 400),
    );
    await env.make().runBatch();
    expect(env.jobs.get(job.id)!.status).toBe('FAILED');
  });

  it('agotados los intentos queda FAILED (sin reintentos infinitos)', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.jobs.get(job.id)!.attempts = DRIVE_BACKUP_LIMITS.maxAttempts - 1;
    env.drive.failNext('uploadFile', new DriveBackupError('transient', 'HTTP 503', 503));
    await env.make().runBatch();
    expect(env.jobs.get(job.id)!.status).toBe('FAILED');
  });
});

describe('eliminación en la app', () => {
  it('foto eliminada antes de copiarse: SOURCE_MISSING, sin subir ni reintentar', async () => {
    const env = setup();
    const job = env.addPhoto({ status: 'PENDING_DELETION' });
    await env.make().runBatch();
    expect(env.jobs.get(job.id)!.status).toBe('SOURCE_MISSING');
    expect(env.drive.uploadedPhotos()).toHaveLength(0);
    expect(env.readSource).not.toHaveBeenCalled();
    env.advance(24 * 60 * 60_000);
    expect(await env.make().runBatch()).toBe(0);
  });

  it('objeto ausente en Neon aunque la fila siga disponible: SOURCE_MISSING', async () => {
    const env = setup({ readSource: async () => null });
    const job = env.addPhoto();
    await env.make().runBatch();
    expect(env.jobs.get(job.id)!.status).toBe('SOURCE_MISSING');
  });

  it('copia ya llegada (respuesta perdida) y foto eliminada después: se conserva y se marca completa', async () => {
    const env = setup();
    const job = env.addPhoto();
    env.drive.loseNextUploadResponse();
    await env.make().runBatch();
    env.sources.get(job.fileAssetId)!.status = 'DELETED';
    env.advance(DRIVE_BACKUP_LIMITS.maxBackoffMs);
    await env.make().runBatch();
    expect(env.jobs.get(job.id)!.status).toBe('COMPLETED');
    expect(env.drive.uploadedPhotos()).toHaveLength(1);
  });

  it('una copia completada no se toca al eliminar la foto en la app', async () => {
    const env = setup();
    const job = env.addPhoto();
    await env.make().runBatch();
    const before = structuredClone([...env.drive.files.values()]);
    env.sources.get(job.fileAssetId)!.status = 'DELETED';
    env.advance(DRIVE_BACKUP_LIMITS.idleRecheckMs);
    expect(await env.make().runBatch()).toBe(0);
    expect([...env.drive.files.values()]).toEqual(before);
    expect(env.jobs.get(job.id)!.status).toBe('COMPLETED');
  });
});

describe('planificador', () => {
  it('sin trabajos: un solo vistazo y luego espera larga (sin sondeo frecuente)', async () => {
    const env = setup();
    const runBatch = vi.fn(async () => 0);
    const nextWakeAt = vi.fn(env.store.nextWakeAt);
    const scheduler = createDriveBackupScheduler({ runBatch }, { nextWakeAt }, 'DEMO', {
      now: () => T0,
    });
    expect(await scheduler.runOnce()).toBe(DRIVE_BACKUP_LIMITS.idleRecheckMs);
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(nextWakeAt).toHaveBeenCalledTimes(1);
  });

  it('con un reintento programado, duerme hasta su vencimiento', async () => {
    const env = setup();
    env.addPhoto({ nextAttemptAt: new Date(T0.getTime() + 90_000) });
    const scheduler = createDriveBackupScheduler(env.make(), env.store, 'DEMO', { now: () => T0 });
    expect(await scheduler.runOnce()).toBe(90_000);
  });

  it('lotes llenos: sigue procesando hasta vaciar lo vencido', async () => {
    const env = setup();
    for (let index = 0; index < 12; index += 1) env.addPhoto();
    const scheduler = createDriveBackupScheduler(env.make(), env.store, 'DEMO', { now: () => T0 });
    await scheduler.runOnce();
    expect([...env.jobs.values()].every((job) => job.status === 'COMPLETED')).toBe(true);
  });

  it('si la base no responde, reintenta en un minuto sin romper el proceso', async () => {
    const scheduler = createDriveBackupScheduler(
      {
        runBatch: async () => {
          throw new Error('db caída');
        },
      },
      { nextWakeAt: async () => null },
      'DEMO',
      { log: () => undefined },
    );
    expect(await scheduler.runOnce()).toBe(DRIVE_BACKUP_LIMITS.storeErrorRetryMs);
  });
});
