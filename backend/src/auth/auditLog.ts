import type { Prisma, PrismaClient } from '../generated/prisma/client';

export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export interface AuditLogEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** NUNCA contraseñas, tokens ni hashes acá — solo estado de negocio (ej. `{ status: 'ACTIVE' }`). */
  previousState?: Prisma.InputJsonValue | null;
  /** Idem `previousState`. */
  newState?: Prisma.InputJsonValue | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditLog(
  client: PrismaClientOrTx,
  entry: AuditLogEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousState: entry.previousState ?? undefined,
      newState: entry.newState ?? undefined,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

/**
 * Para los flujos normales de autenticación (login/refresh/logout): un
 * problema al registrar auditoría no debe tumbar una autenticación
 * válida — se registra el error y se sigue. Distinto de las operaciones
 * administrativas (activar, resetear contraseña, cambiar estado, bootstrap
 * de admin), que llaman a `recordAuditLog` directamente *dentro* de su
 * propia transacción para que sea atómico (si falla la auditoría, se
 * revierte todo).
 */
export async function recordAuditLogSafe(
  client: PrismaClientOrTx,
  entry: AuditLogEntry,
): Promise<void> {
  try {
    await recordAuditLog(client, entry);
  } catch (error) {
    console.error(
      'No se pudo registrar auditoría (no crítico, no interrumpe la operación):',
      error instanceof Error ? error.message : error,
    );
  }
}
