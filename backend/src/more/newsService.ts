import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { findUserIdentities, type UserIdentity } from '../lib/userIdentity';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EmployeeInvalidError,
  EmployeeLinkRequiredError,
  ForbiddenError,
  NewsMessageVersionConflictError,
  NewsNotFoundError,
  ValidationError,
} from '../errors/AppError';
import { startOfLocalDay, toLocalDate } from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type {
  createNewsBodySchema,
  deleteNewsMessageBodySchema,
  updateNewsBodySchema,
} from './moreSchemas';
import {
  assertCanDeleteNewsMessage,
  lostEditRaceError,
  newsMessagePermissions,
  shouldWriteNewsMessageEdit,
} from './newsMessages';

/**
 * 📝 Novedades (docs/BUSINESS_RULES.md §17). Paridad: todo usuario
 * autenticado ve el historial y registra. "¿Quién reporta?": un EMPLOYEE
 * queda fijado a su empleado (la identidad sale de la sesión, mismo criterio
 * aprobado en Gallinero); un ADMIN elige un empleado activo (por defecto el
 * suyo). El actor real queda en `recordedByUserId` + `AuditLog`.
 *
 * Edición y eliminación lógica (autorizadas el 2026-10-30, `newsMessages.ts`):
 * las decide quien REGISTRÓ la novedad (`recordedByUserId`), no quien la
 * reporta. Una novedad eliminada conserva su lugar en el historial como
 * marcador y su texto nunca sale por la API.
 */

type CreateNewsInput = z.infer<typeof createNewsBodySchema>;
type UpdateNewsInput = z.infer<typeof updateNewsBodySchema>;
type DeleteNewsInput = z.infer<typeof deleteNewsMessageBodySchema>;
type Client = Pick<Prisma.TransactionClient, 'newsReport' | '$queryRaw'>;
const CREATE_ENDPOINT = 'POST /news';

const newsSelect = {
  id: true,
  text: true,
  createdAt: true,
  version: true,
  editedAt: true,
  deletedAt: true,
  recordedByUserId: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;
type NewsRow = Prisma.NewsReportGetPayload<{ select: typeof newsSelect }>;

export interface NewsReplyStats {
  /** Solo respuestas NO eliminadas («N respuestas»). */
  replyCount: number;
  /** Hay al menos una respuesta, aunque estén todas eliminadas (marcadores). */
  hasConversation: boolean;
  /** La más reciente entre las no eliminadas. */
  lastReply: { createdAt: string; author: UserIdentity } | null;
}

const EMPTY_STATS: NewsReplyStats = { replyCount: 0, hasConversation: false, lastReply: null };

/**
 * Contador, existencia de conversación y última respuesta vigente de un lote
 * de novedades: una sentencia agrupada con funciones de ventana (sin cuerpos
 * de respuestas) + una resolución de nombres por lote.
 */
export async function findNewsReplyStats(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  newsIds: readonly string[],
): Promise<Map<string, NewsReplyStats>> {
  const stats = new Map<string, NewsReplyStats>();
  if (newsIds.length === 0) return stats;
  const rows = await client.$queryRaw<
    {
      newsReportId: string;
      replyCount: bigint;
      latestAuthorUserId: string;
      latestAt: Date;
      latestActive: boolean;
    }[]
  >(Prisma.sql`
    SELECT ranked."news_report_id"::text AS "newsReportId",
      ranked."reply_count" AS "replyCount",
      ranked."author_user_id"::text AS "latestAuthorUserId",
      ranked."created_at" AS "latestAt",
      ranked."deleted_at" IS NULL AS "latestActive"
    FROM (
      SELECT nr."news_report_id", nr."author_user_id", nr."created_at", nr."deleted_at",
        COUNT(*) FILTER (WHERE nr."deleted_at" IS NULL)
          OVER (PARTITION BY nr."news_report_id") AS "reply_count",
        ROW_NUMBER() OVER (
          PARTITION BY nr."news_report_id"
          ORDER BY (nr."deleted_at" IS NULL) DESC, nr."created_at" DESC, nr."id" DESC
        ) AS "position"
      FROM "news_replies" nr
      WHERE nr."news_report_id" IN (${Prisma.join(newsIds.map((id) => Prisma.sql`${id}::uuid`))})
    ) ranked
    WHERE ranked."position" = 1`);
  const identities = await findUserIdentities(
    client,
    rows.filter((row) => row.latestActive).map((row) => row.latestAuthorUserId),
  );
  for (const row of rows) {
    let lastReply: NewsReplyStats['lastReply'] = null;
    if (row.latestActive) {
      const identity = identities.get(row.latestAuthorUserId);
      if (!identity)
        throw new Error('No se pudo resolver el nombre visible de la última respuesta.');
      lastReply = { createdAt: row.latestAt.toISOString(), author: identity.identity };
    }
    stats.set(row.newsReportId, {
      replyCount: Number(row.replyCount),
      hasConversation: true,
      lastReply,
    });
  }
  return stats;
}

function serializeNews(row: NewsRow, actor: TaskActor, stats: NewsReplyStats) {
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    text: deleted ? null : row.text,
    createdAt: row.createdAt.toISOString(),
    employee: row.employee,
    version: row.version,
    deleted,
    editedAt: deleted ? null : (row.editedAt?.toISOString() ?? null),
    replyCount: stats.replyCount,
    hasConversation: stats.hasConversation,
    lastReply: stats.lastReply,
    permissions: {
      ...newsMessagePermissions(actor, row.recordedByUserId, deleted),
      // Eliminada: se sigue conversando solo si ya había conversación.
      canReply: !deleted || stats.hasConversation,
    },
  };
}

export type SerializedNews = ReturnType<typeof serializeNews>;

async function serializeNewsRows(client: Client, actor: TaskActor, rows: NewsRow[]) {
  const stats = await findNewsReplyStats(
    client,
    rows.map((row) => row.id),
  );
  return rows.map((row) => serializeNews(row, actor, stats.get(row.id) ?? EMPTY_STATS));
}

async function loadNews(client: Client, actor: TaskActor, newsId: string) {
  const row = await client.newsReport.findUnique({ where: { id: newsId }, select: newsSelect });
  if (!row) throw new NewsNotFoundError();
  const [news] = await serializeNewsRows(client, actor, [row]);
  if (!news) throw new NewsNotFoundError();
  return news;
}

/**
 * Historial del más reciente al más antiguo, paginado por fecha de alta: las
 * eliminadas conservan su lugar (marcadores) y cuentan en la paginación.
 * Sentencias fijas: conteo + página + estadísticas + nombres.
 */
export async function listNews(actor: TaskActor, filters: { page: number; pageSize: number }) {
  const [total, rows] = await Promise.all([
    prisma.newsReport.count(),
    prisma.newsReport.findMany({
      select: newsSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return {
    news: await serializeNewsRows(prisma, actor, rows),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

/** Novedades vigentes de hoy (`BUSINESS_TIME_ZONE`) y total — para la tarjeta de Más. */
export async function countNews(now = new Date()) {
  const since = startOfLocalDay(toLocalDate(now, config.businessTimeZone), config.businessTimeZone);
  const [today, total] = await Promise.all([
    prisma.newsReport.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
    prisma.newsReport.count({ where: { deletedAt: null } }),
  ]);
  return { today, total };
}

function resolveReporter(actor: TaskActor, requested: string | undefined): string {
  if (actor.role !== 'ADMIN') {
    if (!actor.employeeId) throw new EmployeeLinkRequiredError();
    if (requested !== undefined && requested.toLowerCase() !== actor.employeeId.toLowerCase()) {
      throw new ForbiddenError(
        'Solo un administrador puede registrar una novedad a nombre de otra persona.',
      );
    }
    return actor.employeeId;
  }
  if (requested !== undefined) return requested.toLowerCase();
  if (!actor.employeeId) throw new ValidationError('Elegí quién reporta.');
  return actor.employeeId;
}

export type CreateNewsResult =
  | { kind: 'created'; body: { news: SerializedNews } }
  | { kind: 'replay'; status: number; body: { news: SerializedNews } };

/**
 * "Registrar novedad". Acepta `Idempotency-Key` (el mismo envío nunca se
 * duplica). Un replay devuelve el estado ACTUAL de la novedad (editada o
 * eliminada), nunca el cuerpo guardado del primer envío.
 */
export async function createNews(
  actor: TaskActor,
  input: CreateNewsInput,
  meta: RequestMeta,
  idempotencyKey?: string,
): Promise<CreateNewsResult> {
  const employeeId = resolveReporter(actor, input.employeeId);

  const write = async (tx: Prisma.TransactionClient) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { active: true },
    });
    if (!employee?.active) throw new EmployeeInvalidError();
    const row = await tx.newsReport.create({
      data: { employeeId, text: input.text, recordedByUserId: actor.userId },
      select: newsSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'news.created',
      entityType: 'NewsReport',
      entityId: row.id,
      newState: { employeeId, chosenByAdmin: employeeId !== actor.employeeId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { news: serializeNews(row, actor, EMPTY_STATS) };
  };

  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  const result = await executeIdempotent({
    actorUserId: actor.userId,
    endpoint: CREATE_ENDPOINT,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([CREATE_ENDPOINT, employeeId, input.text]),
    status: 201,
    run: write,
  });
  if (result.kind === 'created') return result;
  const newsId = (result.body as { news?: { id?: unknown } } | null)?.news?.id;
  if (typeof newsId !== 'string') throw new NewsNotFoundError();
  return {
    kind: 'replay',
    status: result.status,
    body: { news: await loadNews(prisma, actor, newsId) },
  };
}

/**
 * Editar el texto (solo quien la registró). Misma fila: conserva id, persona
 * que reporta, autor, fecha y conversación. Sin cambios efectivos no escribe
 * ni audita. La versión enviada debe ser la vigente (409 si otra pantalla la
 * editó o eliminó). Fila, auditoría (texto anterior/nuevo) y respuesta en una
 * transacción.
 */
export async function updateNews(
  actor: TaskActor,
  newsId: string,
  input: UpdateNewsInput,
  meta: RequestMeta,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.newsReport.findUnique({
      where: { id: newsId },
      select: { recordedByUserId: true, version: true, deletedAt: true, text: true },
    });
    if (!current) throw new NewsNotFoundError();
    const state = { ...current, authorUserId: current.recordedByUserId };
    if (shouldWriteNewsMessageEdit(actor, state, input)) {
      const { count } = await tx.newsReport.updateMany({
        where: { id: newsId, version: input.version, deletedAt: null },
        data: { text: input.text, editedAt: now, version: { increment: 1 } },
      });
      if (count === 0) {
        throw lostEditRaceError(
          await tx.newsReport.findUnique({ where: { id: newsId }, select: { deletedAt: true } }),
        );
      }
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'news.updated',
        entityType: 'NewsReport',
        entityId: newsId,
        previousState: { text: current.text, version: current.version },
        newState: { text: input.text, version: current.version + 1 },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return { news: await loadNews(tx, actor, newsId) };
  });
}

/**
 * Eliminación lógica (autor o ADMIN que modera): la fila, su texto y sus
 * respuestas se conservan; queda «Novedad eliminada». Quien elimina va en
 * `deletedByUserId` y en la auditoría, sin reemplazar al autor. Repetirla
 * sobre una ya eliminada responde el marcador sin escribir ni auditar.
 */
export async function deleteNews(
  actor: TaskActor,
  newsId: string,
  input: DeleteNewsInput,
  meta: RequestMeta,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.newsReport.findUnique({
      where: { id: newsId },
      select: { recordedByUserId: true, version: true, deletedAt: true },
    });
    if (!current) throw new NewsNotFoundError();
    assertCanDeleteNewsMessage(actor, { ...current, authorUserId: current.recordedByUserId });
    if (!current.deletedAt) {
      if (current.version !== input.version) throw new NewsMessageVersionConflictError();
      const { count } = await tx.newsReport.updateMany({
        where: { id: newsId, version: input.version, deletedAt: null },
        data: { deletedAt: now, deletedByUserId: actor.userId, version: { increment: 1 } },
      });
      if (count === 1) {
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'news.deleted',
          entityType: 'NewsReport',
          entityId: newsId,
          previousState: { deleted: false, version: current.version },
          newState: {
            deleted: true,
            version: current.version + 1,
            authorUserId: current.recordedByUserId,
            moderated: current.recordedByUserId !== actor.userId,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      } else {
        const after = await tx.newsReport.findUnique({
          where: { id: newsId },
          select: { deletedAt: true },
        });
        // Otra eliminación ganó: mismo resultado, sin otra auditoría.
        if (!after?.deletedAt) throw new NewsMessageVersionConflictError();
      }
    }
    return { news: await loadNews(tx, actor, newsId) };
  });
}
