import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { config } from '../config';
import { getDriveBackupConfig } from '../driveBackup/config';
import { createDriveClient } from '../driveBackup/driveClient';
import { DriveBackupError } from '../driveBackup/errors';
import { createServiceAccountTokenProvider } from '../driveBackup/googleAuth';
import { createPrismaDriveBackupStore } from '../driveBackup/store';
import { createDriveBackupWorker, FILE_ID_PROPERTY } from '../driveBackup/worker';
import { prisma } from '../lib/prisma';

/**
 * Verificación real de la copia en Drive (Etapa 5Z), a mano y solo en `demo`:
 *
 *   npm run drive:check                       → solo lectura: tipo de destino y permisos
 *   npm run drive:check -- --synthetic-upload → además sube UNA imagen sintética
 *
 * La subida usa el mismo camino que el trabajador (carpetas con ID
 * pre-generado, subida reanudable con ID pre-generado) en
 * `demo/verificacion/<año>/<mes>`, y luego repite la creación con el MISMO ID
 * para comprobar que Drive responde 409 sin duplicar. Nunca copia fotos
 * reales, nunca escribe en `production` y nunca borra nada. No imprime
 * tokens, claves ni el contenido del JSON.
 */

/** PNG sintético 64×64 (degradado verde), generado en memoria. */
function syntheticPng(): Buffer {
  const size = 64;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const rows: number[] = [];
  for (let y = 0; y < size; y += 1) {
    rows.push(0);
    for (let x = 0; x < size; x += 1) rows.push(40 + x, 110 + y * 2, 60);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const print = (value: unknown) => {
  // eslint-disable-next-line no-console -- salida del comando de verificación
  console.log(JSON.stringify(value, null, 2));
};

async function main(): Promise<void> {
  const driveConfig = getDriveBackupConfig();
  if (!driveConfig) {
    throw new Error(
      'La copia en Drive no está activada o está incompleta (ver DRIVE_BACKUP_* en .env.example).',
    );
  }
  const drive = createDriveClient(createServiceAccountTokenProvider(driveConfig.credentialsFile));
  const destination = await drive.describeDestination(driveConfig.destinationId);
  print({ environment: driveConfig.environment, destination });

  if (!process.argv.includes('--synthetic-upload')) return;
  if (driveConfig.environment !== 'DEMO') {
    throw new Error('La subida sintética solo se permite con DRIVE_BACKUP_ENVIRONMENT=demo.');
  }

  const store = createPrismaDriveBackupStore();
  const worker = createDriveBackupWorker({
    config: driveConfig,
    store,
    drive,
    readSource: () => Promise.resolve(null),
    businessTimeZone: config.businessTimeZone,
  });
  const now = new Date();
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.businessTimeZone,
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-');
  const segments = ['demo', 'verificacion', month[0] ?? '', month[1] ?? ''];
  const folderId = await worker.ensureFolder(segments);

  const png = syntheticPng();
  const marker = `verificacion-${randomUUID()}`;
  const id = await drive.generateId();
  const name = `verificacion-sintetica_${marker}.png`;
  const upload = () =>
    drive.uploadFile({
      id,
      name,
      parentId: folderId,
      mimeType: 'image/png',
      sizeBytes: png.length,
      appProperties: { [FILE_ID_PROPERTY]: marker, laCanadaEnv: 'demo' },
      body: new Blob([new Uint8Array(png)]).stream(),
    });
  await upload();

  // Respuesta "perdida": repetir con el MISMO ID debe dar 409, nunca un duplicado.
  let retry = 'sin conflicto (inesperado)';
  try {
    await upload();
  } catch (error) {
    if (!(error instanceof DriveBackupError && error.kind === 'conflict')) throw error;
    retry = '409 Conflict: Drive rechazó el duplicado';
  }
  const copies = await drive.findByAppProperty(FILE_ID_PROPERTY, marker, {
    driveId: destination.driveId,
  });
  const stored = await drive.getFile(id);
  print({
    folderPath: segments.join('/'),
    folderId,
    file: { id, name, sizeBytes: stored?.size, parents: stored?.parents },
    retryWithSameId: retry,
    copiesWithMarker: copies.length,
  });
}

main()
  .catch((error: unknown) => {
    console.error(
      'Verificación de Drive fallida:',
      error instanceof Error ? error.message : 'error inesperado',
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
