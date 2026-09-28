import { randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { recordAuditLog } from './auditLog';
import { hashPin, validatePinPolicy } from './pin';
import { ValidationError } from '../errors/AppError';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';

/**
 * Alta de un usuario ADMIN adicional (Etapa 5U) desde Más → Configuración →
 * Usuarios. Un ADMIN es una persona SIN `Employee`: nunca se le crea uno, así
 * que queda fuera de Tareas, Desempeño y todo selector laboral. Su nombre
 * visible va en `UserProfile` (mismo campo que Mi perfil).
 *
 * Identidad técnica: el login es "elegir identidad + PIN", así que la persona
 * nunca elige ni ve un `username`. El backend genera `admin-<16 hex>` con 64
 * bits de `crypto.randomBytes`: único (índice único de `users.username`; una
 * colisión, prácticamente imposible, se reintenta con otro valor), inmutable,
 * no derivado del nombre, no usado como credencial y nunca devuelto.
 */

export const TECHNICAL_USERNAME_PATTERN = /^admin-[0-9a-f]{16}$/;
const MAX_USERNAME_ATTEMPTS = 3;

export const generateTechnicalUsername = (): string => `admin-${randomBytes(8).toString('hex')}`;

export interface CreateAdminInput {
  displayName: string;
  pin: string;
}

export interface CreatedAdmin {
  id: string;
  role: 'ADMIN';
  status: 'ACTIVE';
  displayName: string;
  createdAt: string;
}

export type CreateAdminResult =
  | { kind: 'created'; body: { user: CreatedAdmin } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/** P2002 sobre `users.username` (y no sobre la reserva de idempotencia). */
function isUsernameCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const target = meta?.target ?? constraint?.fields ?? constraint?.index;
  return Array.isArray(target)
    ? target.includes('username')
    : typeof target === 'string' && target.includes('username');
}

/**
 * En UNA transacción: `User` (ADMIN, ACTIVE, PIN Argon2id, intentos y bloqueo
 * limpios) + `UserProfile` (nombre visible) + `AuditLog`. Todo o nada. El PIN
 * se hashea ANTES de abrir la transacción (Argon2 tarda) y jamás se persiste
 * ni se audita en claro. Con `Idempotency-Key`, la huella del pedido excluye
 * el PIN a propósito: un SHA-256 de 4 dígitos se revierte probando 10.000
 * valores, así que no se guarda ni siquiera hasheado.
 */
export async function createAdminAccount(
  actorUserId: string,
  input: CreateAdminInput,
  meta: { ipAddress: string | null; userAgent: string | null },
  idempotencyKey?: string,
): Promise<CreateAdminResult> {
  const policy = validatePinPolicy(input.pin);
  if (!policy.ok) throw new ValidationError(policy.reason);
  const pinHash = await hashPin(input.pin);

  const write = (username: string) => async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.create({
      data: {
        username,
        role: 'ADMIN',
        status: 'ACTIVE',
        pinHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: { id: true, createdAt: true },
    });
    await tx.userProfile.create({ data: { userId: user.id, displayName: input.displayName } });
    await recordAuditLog(tx, {
      actorUserId,
      action: 'admin.user.created',
      entityType: 'User',
      entityId: user.id,
      newState: { role: 'ADMIN', status: 'ACTIVE', displayName: input.displayName },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    const created: CreatedAdmin = {
      id: user.id,
      role: 'ADMIN',
      status: 'ACTIVE',
      displayName: input.displayName,
      createdAt: user.createdAt.toISOString(),
    };
    return { user: created };
  };

  const endpoint = 'POST /admin/users/admins';
  for (let attempt = 1; ; attempt += 1) {
    const run = write(generateTechnicalUsername());
    try {
      if (idempotencyKey === undefined) {
        return { kind: 'created', body: await prisma.$transaction(run) };
      }
      return await executeIdempotent({
        actorUserId,
        endpoint,
        key: idempotencyKey,
        requestHash: canonicalRequestHash([endpoint, input.displayName]),
        status: 201,
        run: run as (
          tx: Prisma.TransactionClient,
        ) => Promise<{ user: CreatedAdmin } & Prisma.InputJsonObject>,
      });
    } catch (error) {
      if (isUsernameCollision(error) && attempt < MAX_USERNAME_ATTEMPTS) continue;
      throw error;
    }
  }
}
