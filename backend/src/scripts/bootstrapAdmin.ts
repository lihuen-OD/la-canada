import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';
import type { PrismaClient } from '../generated/prisma/client';
import { evaluateGuard } from './guardDbCommand';
import { hashPassword, validatePasswordPolicy } from '../auth/password';
import { recordAuditLog } from '../auth/auditLog';
import { normalizeUsername } from '../utils/username';
import { prisma } from '../lib/prisma';

/**
 * Bootstrap del primer administrador — Etapa 3B.1. NO se ejecuta como parte
 * de esta implementación (ver AGENTS.md regla 3 / pedido explícito de esta
 * etapa): se construye y se testea (con transacciones que terminan en
 * rollback o limpieza determinística contra `demo`), pero el comando real
 * (`npm run auth:bootstrap-admin`) no corre acá.
 *
 * Nunca acepta la contraseña como argumento de línea de comandos (quedaría
 * visible en el historial de shell / `ps`) — se pide de forma interactiva,
 * oculta, vía `@inquirer/prompts` (ver `main()` más abajo).
 */

export interface BootstrapAdminInput {
  username: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type BootstrapAdminResult =
  { created: true; userId: string; username: string } | { created: false; reason: string };

/**
 * Núcleo testeable, sin I/O de terminal — recibe usuario/contraseña ya
 * provistos (por el prompt interactivo, o por un test) en vez de leerlos
 * de `process.argv`/`stdin` directamente.
 */
export async function bootstrapAdmin(
  prisma: PrismaClient,
  input: BootstrapAdminInput,
): Promise<BootstrapAdminResult> {
  const passwordCheck = validatePasswordPolicy(input.password);
  if (!passwordCheck.ok) {
    return { created: false, reason: passwordCheck.reason };
  }

  const normalizedUsername = normalizeUsername(input.username);
  if (!normalizedUsername) {
    return { created: false, reason: 'El nombre de usuario queda vacío después de normalizarlo.' };
  }

  return prisma.$transaction(async (tx) => {
    // Seguro ante una segunda ejecución: si ya existe un ADMIN activo, no
    // se crea otro — sin importar el username pedido esta vez.
    const existingActiveAdmin = await tx.user.findFirst({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (existingActiveAdmin) {
      return { created: false, reason: 'Ya existe un administrador activo — no se crea otro.' };
    }

    const existingUsername = await tx.user.findUnique({
      where: { username: normalizedUsername },
      select: { id: true },
    });
    if (existingUsername) {
      return { created: false, reason: `El username "${normalizedUsername}" ya existe.` };
    }

    const passwordHash = await hashPassword(input.password);
    const admin = await tx.user.create({
      data: {
        username: normalizedUsername,
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
      },
      select: { id: true, username: true },
    });

    await recordAuditLog(tx, {
      actorUserId: admin.id,
      action: 'auth.bootstrap_admin',
      entityType: 'User',
      entityId: admin.id,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    return { created: true, userId: admin.id, username: admin.username };
  });
}

async function main(): Promise<void> {
  loadDotenvFile({ path: resolve(process.cwd(), '../.env') });

  const guardResult = evaluateGuard(process.env, {
    varName: 'DATABASE_URL',
    shape: 'pooled',
    gateTarget: true,
  });
  if (!guardResult.ok) {
    console.error(`✖ ${guardResult.reason}`);
    process.exitCode = 1;
    return;
  }

  const { input, password } = await import('@inquirer/prompts');
  const username = await input({ message: 'Username del administrador:' });
  const plainPassword = await password({
    message: 'Contraseña (no se muestra en pantalla):',
    mask: true,
  });

  try {
    const result = await bootstrapAdmin(prisma, { username, password: plainPassword });
    if (result.created) {
      // eslint-disable-next-line no-console -- confirmación sin datos sensibles (nunca la contraseña ni el hash)
      console.log(`✔ Administrador creado (username: ${result.username}).`);
    } else {
      console.error(`✖ No se creó el administrador: ${result.reason}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      'Error inesperado en el bootstrap del administrador:',
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}
