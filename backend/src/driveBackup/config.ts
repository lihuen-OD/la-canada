import { isAbsolute } from 'node:path';
import type { DriveBackupEnvironment } from '../generated/prisma/enums';
import { env as processEnv } from '../config';
import type { Env } from '../config/env';

/**
 * Configuración de la copia adicional en Google Drive (Etapa 5Z,
 * docs/ARCHITECTURE.md §37). Desactivada por defecto y siempre opcional:
 * nunca lanza ni impide el arranque. Con `DRIVE_BACKUP_ENABLED=true` exige
 * las otras tres variables; si falta alguna, la copia queda desactivada y se
 * informa el motivo (sin valores).
 */

export interface DriveBackupConfig {
  destinationId: string;
  /** Elegido explícitamente: nunca se deduce de `NODE_ENV`. */
  environment: DriveBackupEnvironment;
  /** Ruta absoluta del JSON de la cuenta de servicio (fuera del repositorio). */
  credentialsFile: string;
}

export type DriveBackupConfigResult =
  { enabled: true; config: DriveBackupConfig } | { enabled: false; reason: string | null };

type DriveEnv = Pick<
  Env,
  | 'DRIVE_BACKUP_ENABLED'
  | 'DRIVE_BACKUP_DESTINATION_ID'
  | 'DRIVE_BACKUP_ENVIRONMENT'
  | 'DRIVE_BACKUP_CREDENTIALS_FILE'
>;

const ENVIRONMENTS: Record<string, DriveBackupEnvironment> = {
  demo: 'DEMO',
  production: 'PRODUCTION',
};

/** Carpeta de primer nivel del entorno dentro del destino. */
export const ENVIRONMENT_FOLDER: Record<DriveBackupEnvironment, string> = {
  DEMO: 'demo',
  PRODUCTION: 'production',
};

/** IDs de Drive: letras, dígitos, `-` y `_`. Evita inyectar algo en la URL o en una consulta. */
export const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;

export function readDriveBackupConfig(source: DriveEnv): DriveBackupConfigResult {
  const enabled = source.DRIVE_BACKUP_ENABLED?.trim().toLowerCase();
  if (enabled === undefined || enabled === '' || enabled === 'false') {
    return { enabled: false, reason: null };
  }
  if (enabled !== 'true') {
    return { enabled: false, reason: 'DRIVE_BACKUP_ENABLED debe ser "true" o "false".' };
  }
  const destinationId = source.DRIVE_BACKUP_DESTINATION_ID?.trim() ?? '';
  const environment = ENVIRONMENTS[source.DRIVE_BACKUP_ENVIRONMENT?.trim() ?? ''];
  const credentialsFile = source.DRIVE_BACKUP_CREDENTIALS_FILE?.trim() ?? '';
  if (!DRIVE_ID_PATTERN.test(destinationId)) {
    return { enabled: false, reason: 'DRIVE_BACKUP_DESTINATION_ID falta o no es un ID de Drive.' };
  }
  if (!environment) {
    return {
      enabled: false,
      reason: 'DRIVE_BACKUP_ENVIRONMENT debe ser exactamente "demo" o "production".',
    };
  }
  if (!credentialsFile || !isAbsolute(credentialsFile)) {
    return {
      enabled: false,
      reason: 'DRIVE_BACKUP_CREDENTIALS_FILE debe ser la ruta absoluta del JSON de credenciales.',
    };
  }
  return { enabled: true, config: { destinationId, environment, credentialsFile } };
}

let override: DriveBackupConfigResult | undefined;
let cached: DriveBackupConfigResult | undefined;
let warned = false;

/** `null` = copia desactivada (por defecto, o por configuración incompleta). */
export function getDriveBackupConfig(): DriveBackupConfig | null {
  const result = override ?? (cached ??= readDriveBackupConfig(processEnv));
  if (!result.enabled) {
    if (result.reason && !warned) {
      warned = true;
      console.error(`Copia en Google Drive desactivada: ${result.reason}`);
    }
    return null;
  }
  return result.config;
}

/** Solo tests: fija la configuración. `undefined` restaura la del proceso. */
export function setDriveBackupConfigForTests(config: DriveBackupConfig | null | undefined): void {
  override =
    config === undefined
      ? undefined
      : config === null
        ? { enabled: false, reason: null }
        : { enabled: true, config };
}
