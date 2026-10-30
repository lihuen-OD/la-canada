import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { findUserIdentities } from '../lib/userIdentity';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EmployeeInvalidError,
  EmployeeLinkRequiredError,
  ForbiddenError,
  ValidationError,
} from '../errors/AppError';
import { startOfLocalDay, toLocalDate } from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type { createNewsBodySchema } from './moreSchemas';

/**
 * 📝 Novedades (docs/BUSINESS_RULES.md §17). Paridad: todo usuario
 * autenticado ve el historial y registra; no existe edición ni borrado (el
 * prototipo tampoco los tenía). "¿Quién reporta?": un EMPLOYEE queda fijado a
 * su empleado (la identidad sale de la sesión, mismo criterio aprobado en
 * Gallinero); un ADMIN elige un empleado activo (por defecto el suyo). El
 * actor real queda en `recordedByUserId` + `AuditLog`.
 */

type CreateNewsInput = z.infer<typeof createNewsBodySchema>;
const CREATE_ENDPOINT = 'POST /news';

const newsSelect = {
  id: true,
  text: true,
  createdAt: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;
type NewsRow = Prisma.NewsReportGetPayload<{ select: typeof newsSelect }>;

function serializeNews(row: NewsRow) {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    employee: row.employee,
  };
}

export type SerializedNews = ReturnType<typeof serializeNews>;

/** Historial del más reciente al más antiguo, paginado. Dos sentencias fijas. */
export async function listNews(filters: { page: number; pageSize: number }) {
  const [total, rows] = await Promise.all([
    prisma.newsReport.count(),
    prisma.newsReport.findMany({
      select: newsSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  const statsRows =
    rows.length === 0
      ? []
      : await prisma.$queryRaw<
          { newsReportId: string; replyCount: bigint; latestAuthorUserId: string; latestAt: Date }[]
        >(Prisma.sql`
          SELECT ranked."news_report_id"::text AS "newsReportId",
            ranked."reply_count" AS "replyCount",
            ranked."author_user_id"::text AS "latestAuthorUserId",
            ranked."created_at" AS "latestAt"
          FROM (
            SELECT nr."news_report_id", nr."author_user_id", nr."created_at",
              COUNT(*) OVER (PARTITION BY nr."news_report_id") AS "reply_count",
              ROW_NUMBER() OVER (
                PARTITION BY nr."news_report_id"
                ORDER BY nr."created_at" DESC, nr."id" DESC
              ) AS "position"
            FROM "news_replies" nr
            WHERE nr."news_report_id" IN (${Prisma.join(
              rows.map((row) => Prisma.sql`${row.id}::uuid`),
            )})
          ) ranked
          WHERE ranked."position" = 1`);
  const identities = await findUserIdentities(
    prisma,
    statsRows.map((row) => row.latestAuthorUserId),
  );
  const statsByNewsId = new Map<
    string,
    {
      replyCount: number;
      lastReply: { createdAt: string; author: { displayName: string } };
    }
  >();
  for (const row of statsRows) {
    const identity = identities.get(row.latestAuthorUserId);
    if (!identity) throw new Error('No se pudo resolver el nombre visible de la última respuesta.');
    statsByNewsId.set(row.newsReportId, {
      replyCount: Number(row.replyCount),
      lastReply: { createdAt: row.latestAt.toISOString(), author: identity.identity },
    });
  }
  return {
    news: rows.map((row) => ({
      ...serializeNews(row),
      replyCount: statsByNewsId.get(row.id)?.replyCount ?? 0,
      lastReply: statsByNewsId.get(row.id)?.lastReply ?? null,
    })),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

/** Cantidad de novedades de hoy (`BUSINESS_TIME_ZONE`) y total — para la tarjeta de Más. */
export async function countNews(now = new Date()) {
  const since = startOfLocalDay(toLocalDate(now, config.businessTimeZone), config.businessTimeZone);
  const [today, total] = await Promise.all([
    prisma.newsReport.count({ where: { createdAt: { gte: since } } }),
    prisma.newsReport.count(),
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
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/** "Registrar novedad". Acepta `Idempotency-Key` (el mismo envío nunca se duplica). */
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
    return { news: serializeNews(row) };
  };

  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint: CREATE_ENDPOINT,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([CREATE_ENDPOINT, employeeId, input.text]),
    status: 201,
    run: write,
  });
}
