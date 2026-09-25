import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
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
  return {
    news: rows.map(serializeNews),
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
