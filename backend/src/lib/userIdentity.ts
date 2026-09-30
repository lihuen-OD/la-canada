import { Prisma } from '../generated/prisma/client';
import { ADMIN_FALLBACK_DISPLAY_NAME, resolveVisibleName } from '../auth/authService';

/**
 * Identidad pública del usuario que REGISTRÓ un dato (autor), distinta de la
 * persona asociada a la actividad (`employee`). Solo el nombre visible: nunca
 * `username`, id de usuario, rol ni ningún otro dato de la cuenta.
 *
 * Misma resolución que el resto de la app (`resolveVisibleName`): nombre del
 * `Employee` vinculado → nombre de Mi perfil (`UserProfile`) → «Administrador».
 * El autor sale siempre de datos persistidos por el backend con la sesión
 * autenticada (`recordedByUserId`, `publishedByUserId` o el `actorUserId` de la
 * auditoría de creación), nunca de un valor enviado por el cliente.
 */
// `type` (no `interface`): tiene que poder guardarse como JSON de Prisma en
// las respuestas idempotentes.
export type UserIdentity = { displayName: string };

/** `select` de Prisma para resolver el nombre visible de un `User`. */
export const userIdentitySelect = {
  employee: { select: { displayName: true } },
  personalProfile: { select: { displayName: true } },
} as const;

type IdentityRow = Prisma.UserGetPayload<{ select: typeof userIdentitySelect }>;

export function toUserIdentity(user: IdentityRow | null | undefined): UserIdentity | null {
  return user ? { displayName: resolveVisibleName(user) } : null;
}

/**
 * Autores de un lote de entidades según su auditoría de CREACIÓN (una sola
 * sentencia, índice `audit_logs(entity_type, entity_id)`): para las tablas
 * que no guardan el autor en una columna propia. Solo la acción de alta —
 * nunca una edición o anulación posterior — y solo cuando la evidencia es
 * inequívoca: una única fila de creación con actor. Sin evidencia, la entidad
 * no aparece en el mapa (nunca se deduce un autor).
 */
export async function findCreatorsFromAudit(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  params: { entityType: string; action: string; entityIds: readonly string[] },
): Promise<Map<string, UserIdentity>> {
  const creators = new Map<string, UserIdentity>();
  if (params.entityIds.length === 0) return creators;
  const rows = await client.auditLog.findMany({
    where: {
      entityType: params.entityType,
      action: params.action,
      entityId: { in: [...params.entityIds] },
    },
    select: { entityId: true, actor: { select: userIdentitySelect } },
  });
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (creators.has(row.entityId) || ambiguous.has(row.entityId)) {
      creators.delete(row.entityId);
      ambiguous.add(row.entityId);
      continue;
    }
    const identity = toUserIdentity(row.actor);
    if (identity) creators.set(row.entityId, identity);
    else ambiguous.add(row.entityId);
  }
  return creators;
}

/**
 * Equivalente SQL de `findCreatorsFromAudit` para consultas crudas (reportes):
 * `LEFT JOIN LATERAL` que expone `creator."userId"` y `creator."displayName"`
 * del autor de la fila `entityIdSql`, o `NULL` sin evidencia inequívoca (el
 * mismo criterio: una única auditoría de alta con actor). `condition` limita
 * cuándo se busca (p. ej. solo filas sin persona asociada). Texto SQL fijo;
 * `action`, `entityType` y el fallback viajan como parámetros.
 */
export function auditCreatorJoinSql(params: {
  entityType: string;
  action: string;
  entityIdSql: Prisma.Sql;
  condition?: Prisma.Sql;
}): Prisma.Sql {
  const condition = params.condition ?? Prisma.sql`true`;
  return Prisma.sql`LEFT JOIN LATERAL (
      SELECT cu."id" AS "userId",
        COALESCE(ce."display_name", cp."display_name", ${ADMIN_FALLBACK_DISPLAY_NAME}) AS "displayName"
      FROM (
        SELECT MIN(a."actor_user_id"::text)::uuid AS "actorUserId"
        FROM "audit_logs" a
        WHERE ${condition}
          AND a."entity_type" = ${params.entityType}
          AND a."entity_id" = ${params.entityIdSql}
          AND a."action" = ${params.action}
        HAVING COUNT(*) = 1
      ) creation
      JOIN "users" cu ON cu."id" = creation."actorUserId"
      LEFT JOIN "employees" ce ON ce."id" = cu."employee_id"
      LEFT JOIN "user_profiles" cp ON cp."user_id" = cu."id"
    ) creator ON true`;
}
