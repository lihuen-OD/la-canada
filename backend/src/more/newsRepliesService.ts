import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { recordAuditLog } from '../auth/auditLog';
import { findUserIdentities } from '../lib/userIdentity';
import { canonicalRequestHash, executeIdempotent, assertIdempotencyKey } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import {
  IdempotencyKeyInvalidError,
  NewsConversationClosedError,
  NewsMessageVersionConflictError,
  NewsNotFoundError,
  NewsReplyNotFoundError,
  NewsReplyQuoteDeletedError,
  NewsReplyQuoteInvalidError,
} from '../errors/AppError';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type {
  createNewsReplyBodySchema,
  deleteNewsMessageBodySchema,
  listNewsRepliesQuerySchema,
  updateNewsReplyBodySchema,
} from './moreSchemas';
import {
  assertCanDeleteNewsMessage,
  lostEditRaceError,
  newsMessagePermissions,
  shouldWriteNewsMessageEdit,
} from './newsMessages';
import { findNewsReplyStats, type NewsReplyStats } from './newsService';

const REPLIES_PAGE_SIZE = 20;
const CREATE_REPLY_ENDPOINT = 'POST /news/{newsId}/replies';

type CreateNewsReplyInput = z.infer<typeof createNewsReplyBodySchema>;
type UpdateNewsReplyInput = z.infer<typeof updateNewsReplyBodySchema>;
type DeleteNewsReplyInput = z.infer<typeof deleteNewsMessageBodySchema>;
type ListNewsRepliesQuery = z.infer<typeof listNewsRepliesQuerySchema>;
type Client = Pick<Prisma.TransactionClient, 'newsReply' | '$queryRaw'>;

const newsReplySelect = {
  id: true,
  newsReportId: true,
  authorUserId: true,
  text: true,
  createdAt: true,
  version: true,
  editedAt: true,
  deletedAt: true,
  quotedReply: {
    select: { id: true, text: true, authorUserId: true, editedAt: true, deletedAt: true },
  },
} as const;
type NewsReplyRow = Prisma.NewsReplyGetPayload<{ select: typeof newsReplySelect }>;
type Identities = Awaited<ReturnType<typeof findUserIdentities>>;

function requireIdentity(identities: Identities, userId: string) {
  const resolved = identities.get(userId);
  if (!resolved) throw new Error('No se pudo resolver el nombre visible de una respuesta.');
  return resolved.identity;
}

/**
 * Una respuesta eliminada queda como marcador en su lugar: autor y fecha,
 * sin texto, sin cita y sin acciones. Las citas muestran el estado ACTUAL del
 * mensaje citado (editado o eliminado), nunca su texto anterior.
 */
function serializeNewsReply(row: NewsReplyRow, identities: Identities, actor: TaskActor) {
  const deleted = row.deletedAt !== null;
  const quoted = row.quotedReply;
  const quoteDeleted = quoted?.deletedAt != null;
  return {
    id: row.id,
    text: deleted ? null : row.text,
    createdAt: row.createdAt.toISOString(),
    author: requireIdentity(identities, row.authorUserId),
    version: row.version,
    deleted,
    editedAt: deleted ? null : (row.editedAt?.toISOString() ?? null),
    quote:
      quoted && !deleted
        ? {
            id: quoted.id,
            text: quoteDeleted ? null : quoted.text,
            author: requireIdentity(identities, quoted.authorUserId),
            deleted: quoteDeleted,
            editedAt: quoteDeleted ? null : (quoted.editedAt?.toISOString() ?? null),
          }
        : null,
    permissions: newsMessagePermissions(actor, row.authorUserId, deleted),
  };
}

export type SerializedNewsReply = ReturnType<typeof serializeNewsReply>;

async function serializeReplyRows(client: Client, actor: TaskActor, rows: NewsReplyRow[]) {
  const identities = await findUserIdentities(
    client,
    rows.flatMap((row) => [row.authorUserId, row.quotedReply?.authorUserId]),
  );
  return rows.map((row) => serializeNewsReply(row, identities, actor));
}

async function loadReply(client: Client, actor: TaskActor, newsReportId: string, replyId: string) {
  const row = await client.newsReply.findFirst({
    where: { id: replyId, newsReportId },
    select: newsReplySelect,
  });
  if (!row) throw new NewsReplyNotFoundError();
  const [reply] = await serializeReplyRows(client, actor, [row]);
  if (!reply) throw new NewsReplyNotFoundError();
  return reply;
}

/**
 * Cursor compuesto sobre (createdAt, id): el orden no depende de offsets y
 * continúa siendo estable cuando llegan respuestas nuevas. Las eliminadas
 * conservan su posición (marcadores) y forman parte de cada página.
 */
export async function listNewsReplies(
  actor: TaskActor,
  newsReportId: string,
  query: ListNewsRepliesQuery,
) {
  const news = await prisma.newsReport.findUnique({
    where: { id: newsReportId },
    select: { id: true },
  });
  if (!news) throw new NewsNotFoundError();

  const before =
    query.beforeCreatedAt && query.beforeId
      ? { createdAt: new Date(query.beforeCreatedAt), id: query.beforeId.toLowerCase() }
      : null;
  const rows = await prisma.newsReply.findMany({
    where: {
      newsReportId,
      ...(before
        ? {
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }
        : {}),
    },
    select: newsReplySelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: REPLIES_PAGE_SIZE + 1,
  });

  const pageRows = rows.slice(0, REPLIES_PAGE_SIZE);
  const hasOlder = rows.length > REPLIES_PAGE_SIZE;
  const oldest = pageRows.at(-1);
  return {
    replies: await serializeReplyRows(prisma, actor, [...pageRows].reverse()),
    hasOlder,
    nextCursor:
      hasOlder && oldest ? { createdAt: oldest.createdAt.toISOString(), id: oldest.id } : null,
  };
}

export type CreateNewsReplyResult =
  | { kind: 'created'; body: { reply: SerializedNewsReply } }
  | { kind: 'replay'; status: number; body: { reply: SerializedNewsReply } };

/**
 * Responder. En una novedad eliminada solo si ya tenía conversación; nunca
 * citando una respuesta eliminada. Un replay de la misma clave devuelve el
 * estado ACTUAL de la respuesta creada (editada o eliminada), nunca el
 * cuerpo guardado del primer envío.
 */
export async function createNewsReply(
  actor: TaskActor,
  newsReportId: string,
  input: CreateNewsReplyInput,
  meta: RequestMeta,
  idempotencyKey: string | undefined,
): Promise<CreateNewsReplyResult> {
  if (idempotencyKey === undefined) throw new IdempotencyKeyInvalidError();
  assertIdempotencyKey(idempotencyKey);

  const normalizedNewsId = newsReportId.toLowerCase();
  const quotedReplyId = input.quotedReplyId?.toLowerCase() ?? null;
  const endpoint = CREATE_REPLY_ENDPOINT.replace('{newsId}', normalizedNewsId);

  const write = async (tx: Prisma.TransactionClient) => {
    const news = await tx.newsReport.findUnique({
      where: { id: normalizedNewsId },
      select: { id: true, deletedAt: true },
    });
    if (!news) throw new NewsNotFoundError();
    if (news.deletedAt) {
      const existing = await tx.newsReply.findFirst({
        where: { newsReportId: normalizedNewsId },
        select: { id: true },
      });
      if (!existing) throw new NewsConversationClosedError();
    }

    const quotedReply = quotedReplyId
      ? await tx.newsReply.findFirst({
          where: { id: quotedReplyId, newsReportId: normalizedNewsId },
          select: { id: true, deletedAt: true },
        })
      : null;
    if (quotedReplyId && !quotedReply) throw new NewsReplyQuoteInvalidError();
    if (quotedReply?.deletedAt) throw new NewsReplyQuoteDeletedError();

    const row = await tx.newsReply.create({
      data: {
        newsReportId: normalizedNewsId,
        authorUserId: actor.userId,
        text: input.text,
        quotedReplyId,
      },
      select: newsReplySelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'news.reply.created',
      entityType: 'NewsReply',
      entityId: row.id,
      newState: { newsReportId: normalizedNewsId, quotedReplyId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    const [reply] = await serializeReplyRows(tx, actor, [row]);
    if (!reply) throw new NewsReplyNotFoundError();
    return { reply };
  };

  const result = await executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([endpoint, normalizedNewsId, input.text, quotedReplyId]),
    status: 201,
    run: write,
  });
  if (result.kind === 'created') return result;
  const replyId = (result.body as { reply?: { id?: unknown } } | null)?.reply?.id;
  if (typeof replyId !== 'string') throw new NewsReplyNotFoundError();
  return {
    kind: 'replay',
    status: result.status,
    body: { reply: await loadReply(prisma, actor, normalizedNewsId, replyId) },
  };
}

async function findReplyState(tx: Prisma.TransactionClient, newsReportId: string, replyId: string) {
  const current = await tx.newsReply.findFirst({
    where: { id: replyId, newsReportId },
    select: { authorUserId: true, version: true, deletedAt: true, text: true },
  });
  if (!current) throw new NewsReplyNotFoundError();
  return current;
}

/**
 * Editar una respuesta propia: misma fila (id, autor, fecha, cita y lugar en
 * el hilo). Sin cambios efectivos no escribe ni audita; versión vieja → 409.
 */
export async function updateNewsReply(
  actor: TaskActor,
  newsReportId: string,
  replyId: string,
  input: UpdateNewsReplyInput,
  meta: RequestMeta,
  now = new Date(),
) {
  return prisma.$transaction(async (tx) => {
    const current = await findReplyState(tx, newsReportId, replyId);
    if (shouldWriteNewsMessageEdit(actor, current, input)) {
      const { count } = await tx.newsReply.updateMany({
        where: { id: replyId, newsReportId, version: input.version, deletedAt: null },
        data: { text: input.text, editedAt: now, version: { increment: 1 } },
      });
      if (count === 0) {
        throw lostEditRaceError(
          await tx.newsReply.findUnique({ where: { id: replyId }, select: { deletedAt: true } }),
        );
      }
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'news.reply.updated',
        entityType: 'NewsReply',
        entityId: replyId,
        previousState: { newsReportId, text: current.text, version: current.version },
        newState: { newsReportId, text: input.text, version: current.version + 1 },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return { reply: await loadReply(tx, actor, newsReportId, replyId) };
  });
}

/**
 * Eliminación lógica de una respuesta (autor o ADMIN que modera). Queda
 * «Mensaje eliminado» en su lugar; las citas a ella pasan a mostrar lo
 * mismo. Devuelve también contador y última respuesta vigentes de la
 * novedad para actualizar el listado sin recargarlo.
 */
export async function deleteNewsReply(
  actor: TaskActor,
  newsReportId: string,
  replyId: string,
  input: DeleteNewsReplyInput,
  meta: RequestMeta,
  now = new Date(),
): Promise<{ reply: SerializedNewsReply; conversation: NewsReplyStats }> {
  return prisma.$transaction(async (tx) => {
    const current = await findReplyState(tx, newsReportId, replyId);
    assertCanDeleteNewsMessage(actor, current);
    if (!current.deletedAt) {
      if (current.version !== input.version) throw new NewsMessageVersionConflictError();
      const { count } = await tx.newsReply.updateMany({
        where: { id: replyId, newsReportId, version: input.version, deletedAt: null },
        data: { deletedAt: now, deletedByUserId: actor.userId, version: { increment: 1 } },
      });
      if (count === 1) {
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'news.reply.deleted',
          entityType: 'NewsReply',
          entityId: replyId,
          previousState: { newsReportId, deleted: false, version: current.version },
          newState: {
            newsReportId,
            deleted: true,
            version: current.version + 1,
            authorUserId: current.authorUserId,
            moderated: current.authorUserId !== actor.userId,
          },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        });
      } else {
        const after = await tx.newsReply.findUnique({
          where: { id: replyId },
          select: { deletedAt: true },
        });
        // Otra eliminación ganó: mismo resultado, sin otra auditoría.
        if (!after?.deletedAt) throw new NewsMessageVersionConflictError();
      }
    }
    const reply = await loadReply(tx, actor, newsReportId, replyId);
    const stats = await findNewsReplyStats(tx, [newsReportId]);
    return {
      reply,
      conversation: stats.get(newsReportId) ?? {
        replyCount: 0,
        hasConversation: false,
        lastReply: null,
      },
    };
  });
}
