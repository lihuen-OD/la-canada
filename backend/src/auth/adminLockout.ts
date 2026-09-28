import type { Prisma } from '../generated/prisma/client';
import {
  ActorNoLongerActiveError,
  LastActiveAdminError,
  SelfStatusChangeError,
} from '../errors/AppError';

/**
 * Guarda de "siempre al menos un ADMIN activo" (Etapa 5U). Se llama DENTRO de
 * la transacción del cambio de estado, antes del `UPDATE`, cuando el objetivo
 * es un ADMIN ACTIVO y la transición le corta el acceso (SUSPENDED o
 * DEACTIVATED).
 *
 * 1. Nunca a uno mismo → 409 `AUTH_SELF_STATUS_CHANGE`.
 * 2. Bloquea con `FOR UPDATE` TODAS las filas de ADMIN activos, en orden de id
 *    (orden fijo = sin deadlocks entre dos pedidos cruzados). Un segundo pedido
 *    concurrente espera acá hasta que el primero confirme o revierta, y al
 *    seguir relee las filas ya actualizadas (READ COMMITTED reevalúa el
 *    `WHERE` de las filas bloqueadas).
 * 3. El actor tiene que seguir siendo ADMIN activo después de esperar: si otro
 *    ADMIN lo desactivó mientras tanto, este pedido pierde → 409
 *    `ADMIN_ACTOR_INACTIVE`. Así, "A desactiva a B" y "B desactiva a A" al
 *    mismo tiempo nunca dejan a los dos inactivos.
 * 4. Tiene que quedar al menos otro ADMIN activo → si no, 409 `ADMIN_LAST_ACTIVE`.
 *    Con 1 y 3, por esta vía siempre queda el actor: es defensa en profundidad
 *    (cubre una vía futura que no tuviera las dos reglas anteriores).
 */
export async function assertAdminCanBeDeactivated(
  tx: Prisma.TransactionClient,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  if (actorUserId === targetUserId) throw new SelfStatusChangeError();
  const active = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
  const ids = new Set(active.map((row) => row.id));
  if (!ids.has(actorUserId)) throw new ActorNoLongerActiveError();
  ids.delete(targetUserId);
  if (ids.size === 0) throw new LastActiveAdminError();
}
