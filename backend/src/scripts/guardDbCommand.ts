import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';

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
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/** Pura — no lee `process.env` por sí misma, para poder testearla con entornos sintéticos. */
export function evaluateGuard(env: NodeJS.ProcessEnv, options: GuardOptions): GuardResult {
  if (options.gateTarget && env.DATABASE_TARGET !== 'demo') {
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

  if (varName !== 'DATABASE_URL' && varName !== 'DIRECT_URL') {
    throw new Error(
      'Uso: guardDbCommand.ts --require <DATABASE_URL|DIRECT_URL> --shape <pooled|direct> [--gate-target]',
    );
  }
  if (shape !== 'pooled' && shape !== 'direct') {
    throw new Error(
      'Uso: guardDbCommand.ts --require <DATABASE_URL|DIRECT_URL> --shape <pooled|direct> [--gate-target]',
    );
  }

  return { varName, shape, gateTarget };
}

function main(): void {
  loadDotenvFile({ path: resolve(process.cwd(), '../.env') });

  const options = parseArgs(process.argv.slice(2));
  const result = evaluateGuard(process.env, options);

  if (!result.ok) {
    console.error(`✖ ${result.reason}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console -- confirmación sin datos sensibles
  console.log(
    `✔ Guard OK — ${options.varName} presente (${options.shape})` +
      (options.gateTarget ? ', DATABASE_TARGET=demo.' : '.'),
  );
}

if (require.main === module) {
  main();
}
