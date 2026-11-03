import { existsSync, readFileSync } from 'node:fs';
import { parse as parseDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { loadLocalEnvFiles } from '../config/localEnvFiles';

/**
 * Guarda previa a cualquier comando local con capacidad de escritura
 * (migraciones locales, seed, tests de integración) — ver
 * `docs/ARCHITECTURE.md`, "Neon — rama demo". Falla ANTES de invocar Prisma
 * o abrir cualquier conexión, nunca revela el valor de ninguna variable.
 *
 * No previene una evasión deliberada (editar el código o correr Prisma a
 * mano) — solo evita que los scripts oficiales del proyecto actúen por
 * error contra el destino equivocado.
 */

export type ConnectionShape = 'pooled' | 'direct';

export interface GuardOptions {
  varName: 'DATABASE_URL' | 'DIRECT_URL';
  shape: ConnectionShape;
  /** Exige además `DATABASE_TARGET=demo`. Nunca se usa para comandos de solo lectura. */
  gateTarget: boolean;
  /**
   * Exige una rama de Neon AISLADA (`DATABASE_TARGET=isolated`, cargada con
   * `LA_CANADA_ENV_FILE`) cuyo endpoint no sea el de `demo` del `.env`, y la
   * copia en Drive y el almacenamiento real desactivados.
   */
  gateIsolated?: boolean;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Endpoint de Neon de una conexión: primer segmento del host sin `-pooler`
 * (`ep-xxx-pooler.región.aws.neon.tech` → `ep-xxx`). `null` si no se puede leer.
 */
export function neonEndpointOf(connection: string | undefined): string | null {
  if (!connection) return null;
  try {
    const label = new URL(connection).hostname.split('.')[0] ?? '';
    return label.replace(/-pooler$/i, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * La rama aislada no puede ser `demo`: sus dos conexiones apuntan al MISMO
 * endpoint y ese endpoint no es ninguno de los del `.env` de `demo`
 * (`reference`). `production` no tiene conexiones locales: se rechaza por
 * nombre. Nunca devuelve ni compara valores completos, solo endpoints.
 */
export function evaluateIsolation(
  env: NodeJS.ProcessEnv,
  reference: NodeJS.ProcessEnv,
): GuardResult {
  if (env.DATABASE_TARGET !== 'isolated') {
    return {
      ok: false,
      reason:
        'DATABASE_TARGET debe ser "isolated" (cargalo con LA_CANADA_ENV_FILE=.env.<rama>) para este comando.',
    };
  }
  if (reference.DATABASE_TARGET !== 'demo') {
    return {
      ok: false,
      reason:
        'El `.env` de referencia debe ser el de demo (DATABASE_TARGET=demo) para comparar el destino.',
    };
  }
  const pooled = neonEndpointOf(env.DATABASE_URL);
  const direct = neonEndpointOf(env.DIRECT_URL);
  if (!pooled || !direct || pooled !== direct) {
    return {
      ok: false,
      reason:
        'DATABASE_URL y DIRECT_URL de la rama aislada deben existir y apuntar al mismo endpoint de Neon.',
    };
  }
  const demoEndpoints = [
    neonEndpointOf(reference.DATABASE_URL),
    neonEndpointOf(reference.DIRECT_URL),
  ];
  if (demoEndpoints.some((endpoint) => endpoint === null)) {
    return { ok: false, reason: 'No se pudo leer el endpoint de demo del `.env` para compararlo.' };
  }
  if (demoEndpoints.includes(pooled)) {
    return {
      ok: false,
      reason: 'La conexión "aislada" apunta al mismo endpoint que demo: no es una rama aislada.',
    };
  }
  if ((env.DRIVE_BACKUP_ENABLED ?? '').trim().toLowerCase() === 'true') {
    return {
      ok: false,
      reason: 'Desactivá la copia en Drive (DRIVE_BACKUP_ENABLED=false) en la rama aislada.',
    };
  }
  if ((env.OBJECT_STORAGE_ENDPOINT ?? '').trim() !== '') {
    return {
      ok: false,
      reason:
        'Dejá OBJECT_STORAGE_ENDPOINT vacío en la rama aislada: las pruebas no usan almacenamiento real.',
    };
  }
  return { ok: true };
}

/** Pura — no lee `process.env` por sí misma, para poder testearla con entornos sintéticos. */
export function evaluateGuard(
  env: NodeJS.ProcessEnv,
  options: GuardOptions,
  reference: NodeJS.ProcessEnv = {},
): GuardResult {
  if (options.gateIsolated) {
    const isolation = evaluateIsolation(env, reference);
    if (!isolation.ok) return isolation;
  } else if (options.gateTarget && env.DATABASE_TARGET !== 'demo') {
    return {
      ok: false,
      reason:
        'DATABASE_TARGET debe ser exactamente "demo" para ejecutar este comando localmente. ' +
        'Este script nunca corre contra production — eso se diseñará específicamente al preparar Render.',
    };
  }

  const value = env[options.varName];
  if (!value) {
    return {
      ok: false,
      reason: `${options.varName} no está definida — no se puede continuar sin revelar su contenido.`,
    };
  }

  const looksPooled = /-pooler\./i.test(value);
  if (options.shape === 'pooled' && !looksPooled) {
    return {
      ok: false,
      reason: `${options.varName} no tiene la forma de una conexión pooled esperada (falta "-pooler" en el host).`,
    };
  }
  if (options.shape === 'direct' && looksPooled) {
    return {
      ok: false,
      reason: `${options.varName} no tiene la forma de una conexión directa esperada (no debería incluir "-pooler").`,
    };
  }

  return { ok: true };
}

function parseArgs(argv: string[]): GuardOptions {
  const requireIndex = argv.indexOf('--require');
  const shapeIndex = argv.indexOf('--shape');
  const varName = requireIndex >= 0 ? argv[requireIndex + 1] : undefined;
  const shape = shapeIndex >= 0 ? argv[shapeIndex + 1] : undefined;
  const gateTarget = argv.includes('--gate-target');
  const gateIsolated = argv.includes('--gate-isolated');

  if (varName !== 'DATABASE_URL' && varName !== 'DIRECT_URL') {
    throw new Error(
      'Uso: guardDbCommand.ts --require <DATABASE_URL|DIRECT_URL> --shape <pooled|direct> [--gate-target | --gate-isolated]',
    );
  }
  if (shape !== 'pooled' && shape !== 'direct') {
    throw new Error(
      'Uso: guardDbCommand.ts --require <DATABASE_URL|DIRECT_URL> --shape <pooled|direct> [--gate-target | --gate-isolated]',
    );
  }

  return { varName, shape, gateTarget, gateIsolated };
}

/** El `.env` de la raíz SOLO como referencia (sin cargarlo): lo que hoy apunta a `demo`. */
function readReferenceEnv(rootDir: string): NodeJS.ProcessEnv {
  const path = resolve(rootDir, '.env');
  return existsSync(path) ? parseDotenv(readFileSync(path)) : {};
}

function main(): void {
  const rootDir = resolve(process.cwd(), '..');
  const reference = readReferenceEnv(rootDir);
  loadLocalEnvFiles(rootDir);

  const options = parseArgs(process.argv.slice(2));
  const result = evaluateGuard(process.env, options, reference);

  if (!result.ok) {
    console.error(`✖ ${result.reason}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console -- confirmación sin datos sensibles
  console.log(
    `✔ Guard OK — ${options.varName} presente (${options.shape})` +
      (options.gateIsolated
        ? ', rama aislada (endpoint distinto del de demo; Drive y almacenamiento desactivados).'
        : options.gateTarget
          ? ', DATABASE_TARGET=demo.'
          : '.'),
  );
}

if (require.main === module) {
  main();
}
