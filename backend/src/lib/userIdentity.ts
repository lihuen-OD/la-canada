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
/**
 * Autor resuelto: su nombre público más la identidad estable (`userId` y
 * `employeeId` vinculado) que se usa SOLO en el servidor para saber si el
 * autor es el mismo participante; nunca sale en un DTO.
 */
export type RecordCreator = { userId: string; employeeId: string | null; identity: UserIdentity };

export async function findCreatorsFromAudit(
  client: Pick<Prisma.TransactionClient, 'auditLog' | '$queryRaw'>,
  params: { entityType: string; action: string; entityIds: readonly string[] },
): Promise<Map<string, RecordCreator>> {
  const actors = await findCreationActors(client, params);
  const identities = await findUserIdentities(client, actors.values());
  const creators = new Map<string, RecordCreator>();
  for (const [entityId, actorUserId] of actors) {
    const creator = identities.get(actorUserId);
    if (creator) creators.set(entityId, creator);
  }
  return creators;
}

/**
 * Solo el `actorUserId` de la auditoría de alta de cada entidad (una
 * sentencia), para quien necesita resolver el nombre junto con otros
 * usuarios en una sola consulta (`findUserIdentities`). Ambigua o sin actor:
 * la entidad no aparece.
 */
export async function findCreationActors(
  client: Pick<Prisma.TransactionClient, 'auditLog'>,
  params: { entityType: string; action: string; entityIds: readonly string[] },
): Promise<Map<string, string>> {
  const actors = new Map<string, string>();
  if (params.entityIds.length === 0) return actors;
  const rows = await client.auditLog.findMany({
    where: {
      entityType: params.entityType,
      action: params.action,
      entityId: { in: [...params.entityIds] },
    },
    select: { entityId: true, actorUserId: true },
  });
  const seen = new Set<string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.entityId)) ambiguous.add(row.entityId);
    seen.add(row.entityId);
    if (row.actorUserId) actors.set(row.entityId, row.actorUserId);
    else ambiguous.add(row.entityId);
  }
  for (const entityId of ambiguous) actors.delete(entityId);
  return actors;
}

/**
 * Equivalente SQL de `findCreatorsFromAudit` para consultas crudas (reportes):
 * `LEFT JOIN LATERAL` que expone `creator."userId"`, `creator."employeeId"` y
 * `creator."displayName"`
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
      SELECT cu."id" AS "userId", cu."employee_id" AS "employeeId",
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

/**
 * El autor solo se muestra aparte cuando NO es el participante: sin
 * participante (registros anteriores de un ADMIN con «Administrador») o
 * cuando registró a nombre de otra persona («Consumió: Viki · Registró:
 * Benja»). Compara identidades estables, nunca nombres.
 */
export function recorderIfDifferent(
  participant: { employeeId: string | null; participantUserId: string | null },
  recorder: { userId: string; employeeId: string | null; identity: UserIdentity } | null,
): UserIdentity | null {
  if (!recorder) return null;
  const same =
    (participant.participantUserId !== null && participant.participantUserId === recorder.userId) ||
    (participant.employeeId !== null && participant.employeeId === recorder.employeeId);
  return same ? null : recorder.identity;
}

/**
 * Nombre visible e identidad estable de un lote de usuarios en UNA sentencia
 * (JOIN con `employees` y `user_profiles`): para resolver participantes y
 * autores de una página sin una consulta por relación ni por registro. Misma
 * resolución que `resolveVisibleName`.
 */
export async function findUserIdentities(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, { userId: string; employeeId: string | null; identity: UserIdentity }>> {
  const ids = [...new Set([...userIds].filter((id): id is string => Boolean(id)))];
  const identities = new Map<
    string,
    { userId: string; employeeId: string | null; identity: UserIdentity }
  >();
  if (ids.length === 0) return identities;
  const rows = await client.$queryRaw<
    { id: string; employeeId: string | null; displayName: string }[]
  >(Prisma.sql`
    SELECT u."id"::text AS "id", u."employee_id"::text AS "employeeId",
      COALESCE(e."display_name", p."display_name", ${ADMIN_FALLBACK_DISPLAY_NAME}) AS "displayName"
    FROM "users" u
    LEFT JOIN "employees" e ON e."id" = u."employee_id"
    LEFT JOIN "user_profiles" p ON p."user_id" = u."id"
    WHERE u."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
  for (const row of rows) {
    identities.set(row.id, {
      userId: row.id,
      employeeId: row.employeeId,
      identity: { displayName: row.displayName },
    });
  }
  return identities;
}
