import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { recordAuditLog } from '../auth/auditLog';
import { findUserIdentities } from '../lib/userIdentity';
import { canonicalRequestHash, executeIdempotent, assertIdempotencyKey } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import {
  IdempotencyKeyInvalidError,
  NewsNotFoundError,
  NewsReplyQuoteInvalidError,
} from '../errors/AppError';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type { createNewsReplyBodySchema, listNewsRepliesQuerySchema } from './moreSchemas';

const REPLIES_PAGE_SIZE = 20;
const CREATE_REPLY_ENDPOINT = 'POST /news/{newsId}/replies';

type CreateNewsReplyInput = z.infer<typeof createNewsReplyBodySchema>;
type ListNewsRepliesQuery = z.infer<typeof listNewsRepliesQuerySchema>;

const newsReplySelect = {
  id: true,
  newsReportId: true,
  authorUserId: true,
  text: true,
  createdAt: true,
  quotedReply: {
    select: { id: true, text: true, authorUserId: true },
  },
} as const;
type NewsReplyRow = Prisma.NewsReplyGetPayload<{ select: typeof newsReplySelect }>;

function requireIdentity(
  identities: Awaited<ReturnType<typeof findUserIdentities>>,
  userId: string,
) {
  const resolved = identities.get(userId);
  if (!resolved) throw new Error('No se pudo resolver el nombre visible de una respuesta.');
  return resolved.identity;
}

function serializeNewsReply(
  row: NewsReplyRow,
  identities: Awaited<ReturnType<typeof findUserIdentities>>,
) {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    author: requireIdentity(identities, row.authorUserId),
    quote: row.quotedReply
      ? {
          id: row.quotedReply.id,
          text: row.quotedReply.text,
          author: requireIdentity(identities, row.quotedReply.authorUserId),
        }
      : null,
  };
}

export type SerializedNewsReply = ReturnType<typeof serializeNewsReply>;

/**
 * Cursor compuesto sobre (createdAt, id): el orden no depende de offsets y
 * continúa siendo estable cuando llegan respuestas nuevas.
 */
export async function listNewsReplies(newsReportId: string, query: ListNewsRepliesQuery) {
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
  const identities = await findUserIdentities(
    prisma,
    pageRows.flatMap((row) => [row.authorUserId, row.quotedReply?.authorUserId]),
  );
  const oldest = pageRows.at(-1);
  return {
    replies: [...pageRows].reverse().map((row) => serializeNewsReply(row, identities)),
    hasOlder,
    nextCursor:
      hasOlder && oldest ? { createdAt: oldest.createdAt.toISOString(), id: oldest.id } : null,
  };
}

export type CreateNewsReplyResult =
  | { kind: 'created'; body: { reply: SerializedNewsReply } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

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
      select: { id: true },
    });
    if (!news) throw new NewsNotFoundError();

    const quotedReply = quotedReplyId
      ? await tx.newsReply.findFirst({
          where: { id: quotedReplyId, newsReportId: normalizedNewsId },
          select: { id: true, authorUserId: true },
        })
      : null;
    if (quotedReplyId && !quotedReply) throw new NewsReplyQuoteInvalidError();

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
    const identities = await findUserIdentities(tx, [actor.userId, row.quotedReply?.authorUserId]);
    return { reply: serializeNewsReply(row, identities) };
  };

  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([endpoint, normalizedNewsId, input.text, quotedReplyId]),
    status: 201,
    run: write,
  });
}
