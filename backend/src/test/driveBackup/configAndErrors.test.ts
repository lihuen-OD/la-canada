import { describe, expect, it } from 'vitest';
import { readDriveBackupConfig } from '../../driveBackup/config';
import {
  classifyHttpError,
  DriveBackupError,
  httpError,
  sanitizeError,
} from '../../driveBackup/errors';

const FULL = {
  DRIVE_BACKUP_ENABLED: 'true',
  DRIVE_BACKUP_DESTINATION_ID: '0AKPasFkRa2CPUk9PVA',
  DRIVE_BACKUP_ENVIRONMENT: 'demo',
  DRIVE_BACKUP_CREDENTIALS_FILE: '/Users/alguien/secretos/la-canada-drive.json',
};

describe('configuración de la copia en Drive', () => {
  it('desactivada por defecto (sin variables, vacía o "false"), sin aviso', () => {
    expect(readDriveBackupConfig({})).toEqual({ enabled: false, reason: null });
    expect(readDriveBackupConfig({ ...FULL, DRIVE_BACKUP_ENABLED: '' })).toEqual({
      enabled: false,
      reason: null,
    });
    expect(readDriveBackupConfig({ ...FULL, DRIVE_BACKUP_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('activada y completa', () => {
    expect(readDriveBackupConfig(FULL)).toEqual({
      enabled: true,
      config: {
        destinationId: '0AKPasFkRa2CPUk9PVA',
        environment: 'DEMO',
        credentialsFile: '/Users/alguien/secretos/la-canada-drive.json',
      },
    });
    expect(
      readDriveBackupConfig({ ...FULL, DRIVE_BACKUP_ENVIRONMENT: 'production' }),
    ).toMatchObject({ config: { environment: 'PRODUCTION' } });
  });

  it('el entorno es explícito: nunca se deduce de NODE_ENV', () => {
    const withoutEnvironment = { ...FULL, DRIVE_BACKUP_ENVIRONMENT: undefined };
    expect(
      readDriveBackupConfig({
        ...withoutEnvironment,
        NODE_ENV: 'production',
      } as unknown as typeof FULL),
    ).toMatchObject({ enabled: false, reason: expect.stringMatching(/DRIVE_BACKUP_ENVIRONMENT/) });
    for (const value of ['prod', 'Production', 'development', 'test']) {
      expect(readDriveBackupConfig({ ...FULL, DRIVE_BACKUP_ENVIRONMENT: value }).enabled).toBe(
        false,
      );
    }
  });

  it('activada pero incompleta: queda desactivada con un motivo que no muestra valores', () => {
    const cases = [
      { ...FULL, DRIVE_BACKUP_DESTINATION_ID: '' },
      { ...FULL, DRIVE_BACKUP_DESTINATION_ID: "x' or name contains '" },
      { ...FULL, DRIVE_BACKUP_CREDENTIALS_FILE: '' },
      { ...FULL, DRIVE_BACKUP_CREDENTIALS_FILE: 'relativa/creds.json' },
      { ...FULL, DRIVE_BACKUP_ENABLED: 'sí' },
    ];
    for (const source of cases) {
      const result = readDriveBackupConfig(source);
      expect(result.enabled).toBe(false);
      const reason = (result as { reason: string }).reason;
      expect(reason).toMatch(/DRIVE_BACKUP_/);
      expect(reason).not.toMatch(/0AKPas|alguien|relativa/);
    }
  });
});

describe('clasificación de errores', () => {
  it('temporales: red, 429, 5xx, cuota de Google y 401 (token renovable)', () => {
    expect(classifyHttpError(429, null)).toBe('transient');
    expect(classifyHttpError(500, null)).toBe('transient');
    expect(classifyHttpError(503, null)).toBe('transient');
    expect(classifyHttpError(403, 'userRateLimitExceeded')).toBe('transient');
    expect(classifyHttpError(403, 'rateLimitExceeded')).toBe('transient');
    expect(classifyHttpError(401, null)).toBe('transient');
    expect(sanitizeError(new Error('ECONNRESET')).kind).toBe('transient');
    expect(sanitizeError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toEqual({
      kind: 'transient',
      message: 'Tiempo de espera agotado.',
    });
  });

  it('permisos o configuración: 403 sin cuota; 404 informado aparte; 400 inválido; 409 conflicto', () => {
    expect(classifyHttpError(403, 'insufficientFilePermissions')).toBe('config');
    expect(classifyHttpError(403, null)).toBe('config');
    expect(classifyHttpError(404, 'notFound')).toBe('not_found');
    expect(classifyHttpError(400, 'badRequest')).toBe('invalid');
    expect(classifyHttpError(409, null)).toBe('conflict');
  });

  it('los mensajes nunca incluyen el cuerpo, URLs, tokens ni texto libre de Google', () => {
    const error = httpError('files.create', 403, {
      error: {
        errors: [{ reason: 'insufficientFilePermissions', message: 'token ya29.SECRETO' }],
        message: 'https://www.googleapis.com/upload?upload_id=SECRETO',
      },
    });
    expect(error.message).toBe(
      'Drive files.create respondió HTTP 403 (insufficientFilePermissions).',
    );
    const hostile = httpError('files.get', 400, {
      error: { errors: [{ reason: 'https://evil/ya29.token' }] },
    });
    expect(hostile.message).toBe('Drive files.get respondió HTTP 400.');
    expect(sanitizeError(new Error('Bearer ya29.SECRETO')).message).not.toMatch(/SECRETO/);
    expect(
      sanitizeError(new DriveBackupError('config', 'x'.repeat(500))).message.length,
    ).toBeLessThanOrEqual(200);
  });
});
