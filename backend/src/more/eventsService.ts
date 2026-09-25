import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import type { EventType } from '../generated/prisma/enums';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EventDuplicateError,
  EventNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../errors/AppError';
import { formatLocalDate, parseLocalDate, toLocalDate, type LocalDate } from '../lib/businessTime';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import {
  monthDayOf,
  upcomingBirthdays,
  type BirthdayInput,
  type BirthdaySource,
} from './birthdays';
import type { createEventBodySchema, updateEventBodySchema } from './moreSchemas';

/**
 * 📅 Eventos (docs/BUSINESS_RULES.md §13–§14). Paridad: todos ven eventos y
 * cumpleaños; crear, editar y eliminar es solo de ADMIN. "Eliminar" es una
 * anulación lógica auditada (el prototipo borraba la fila). Los cumpleaños no
 * son filas: se derivan al leer (ver `birthdays.ts`) y no se editan acá — se
 * corrigen en su origen (Mi perfil, la ficha de la mascota).
 */

type CreateEventInput = z.infer<typeof createEventBodySchema>;
type UpdateEventInput = z.infer<typeof updateEventBodySchema>;

const MAX_UPCOMING_EVENTS = 200;
const dateText = (value: Date): string => value.toISOString().slice(0, 10);
const toDbDate = (date: LocalDate): Date => new Date(Date.UTC(date.year, date.month - 1, date.day));
const businessToday = (now: Date) => toLocalDate(now, config.businessTimeZone);
const dayNumber = (text: string) => Date.parse(`${text}T00:00:00.000Z`) / 86_400_000;

function requireAdmin(actor: TaskActor, message: string): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError(message);
}

/** Fecha de calendario real; pasada o futura (un evento puede planificarse o registrarse). */
function resolveEventDate(text: string): LocalDate {
  const local = parseLocalDate(text);
  if (!local || local.year < 1900 || local.year > 2100) {
    throw new ValidationError('La fecha del evento no es válida.');
  }
  return local;
}

const eventSelect = { id: true, title: true, date: true, type: true, note: true } as const;
type EventRow = Prisma.EventGetPayload<{ select: typeof eventSelect }>;

function serializeEvent(row: EventRow, today: string) {
  const date = dateText(row.date);
  return {
    kind: 'event' as const,
    id: row.id,
    title: row.title,
    date,
    type: row.type,
    note: row.note,
    daysUntil: dayNumber(date) - dayNumber(today),
  };
}

export type SerializedEvent = ReturnType<typeof serializeEvent>;

const RELATIONSHIP_LABEL: Record<string, string> = { familia: 'Familia' };

/** Los cumpleaños vigentes de las cuatro fuentes. Cuatro sentencias de base (más una por relación). */
async function loadBirthdayInputs(): Promise<BirthdayInput[]> {
  const [family, profiles, children, animals] = await Promise.all([
    prisma.recurringBirthday.findMany({
      where: { active: true },
      select: { id: true, personLabel: true, month: true, day: true, relationship: true },
    }),
    prisma.employeeProfile.findMany({
      where: { birthDate: { not: null }, employee: { active: true } },
      select: { employeeId: true, birthDate: true, employee: { select: { displayName: true } } },
    }),
    prisma.employeeChild.findMany({
      where: { birthDate: { not: null }, employee: { active: true } },
      select: {
        id: true,
        name: true,
        birthDate: true,
        employee: { select: { displayName: true } },
      },
    }),
    prisma.animal.findMany({
      where: { active: true, birthDate: { not: null } },
      select: { id: true, name: true, birthDate: true },
    }),
  ]);
  const of = (
    source: BirthdaySource,
    sourceId: string,
    name: string,
    date: Date,
    note: string,
  ) => ({
    source,
    sourceId,
    name,
    note,
    ...monthDayOf(date),
  });
  return [
    ...family.map((row) => ({
      source: 'FAMILY' as const,
      sourceId: row.id,
      name: row.personLabel,
      month: row.month,
      day: row.day,
      note: row.relationship
        ? (RELATIONSHIP_LABEL[row.relationship] ?? row.relationship)
        : 'Familia',
    })),
    ...profiles.map((row) =>
      of('EMPLOYEE', row.employeeId, row.employee.displayName, row.birthDate as Date, 'Equipo'),
    ),
    ...children.map((row) =>
      of('CHILD', row.id, row.name, row.birthDate as Date, `Hijo/a de ${row.employee.displayName}`),
    ),
    ...animals.map((row) => of('PET', row.id, row.name, row.birthDate as Date, 'Mascota')),
  ];
}

function birthdayItems(inputs: readonly BirthdayInput[], today: LocalDate) {
  return upcomingBirthdays(inputs, today).map((birthday) => ({
    kind: 'birthday' as const,
    id: `${birthday.source.toLowerCase()}:${birthday.sourceId}`,
    title: `Cumpleaños de ${birthday.name}`,
    date: birthday.date,
    type: 'BIRTHDAY' as const,
    note: birthday.note,
    daysUntil: birthday.daysUntil,
    source: birthday.source,
  }));
}

/**
 * Próximos (eventos desde hoy + cumpleaños derivados, por fecha) y Pasados
 * (paginados, del más reciente al más antiguo), con el filtro de tipo del
 * prototipo. Sentencias fijas, independientes del número de filas.
 */
export async function listEvents(
  filters: { type?: EventType; pastPage: number; pastPageSize: number },
  now = new Date(),
) {
  const today = businessToday(now);
  const todayText = formatLocalDate(today);
  const todayDb = toDbDate(today);
  const base: Prisma.EventWhereInput = {
    deletedAt: null,
    ...(filters.type ? { type: filters.type } : {}),
  };
  const pastWhere: Prisma.EventWhereInput = { ...base, date: { lt: todayDb } };
  const withBirthdays = !filters.type || filters.type === 'BIRTHDAY';
  const [upcoming, pastTotal, past, birthdayInputs] = await Promise.all([
    prisma.event.findMany({
      where: { ...base, date: { gte: todayDb } },
      select: eventSelect,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: MAX_UPCOMING_EVENTS,
    }),
    prisma.event.count({ where: pastWhere }),
    prisma.event.findMany({
      where: pastWhere,
      select: eventSelect,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.pastPage - 1) * filters.pastPageSize,
      take: filters.pastPageSize,
    }),
    withBirthdays ? loadBirthdayInputs() : Promise.resolve([]),
  ]);
  const items = [
    ...upcoming.map((row) => serializeEvent(row, todayText)),
    ...birthdayItems(birthdayInputs, today),
  ].sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title, 'es'));
  return {
    today: todayText,
    upcoming: items,
    past: {
      items: past.map((row) => serializeEvent(row, todayText)),
      page: filters.pastPage,
      pageSize: filters.pastPageSize,
      total: pastTotal,
      totalPages: Math.max(1, Math.ceil(pastTotal / filters.pastPageSize)),
    },
  };
}

/** Próximos eventos (desde hoy) + cumpleaños vigentes — la tarjeta de Más. Solo conteos. */
export async function countUpcomingEvents(now = new Date()) {
  const todayDb = toDbDate(businessToday(now));
  const counts = await Promise.all([
    prisma.event.count({ where: { deletedAt: null, date: { gte: todayDb } } }),
    prisma.recurringBirthday.count({ where: { active: true } }),
    prisma.employeeProfile.count({
      where: { birthDate: { not: null }, employee: { active: true } },
    }),
    prisma.employeeChild.count({ where: { birthDate: { not: null }, employee: { active: true } } }),
    prisma.animal.count({ where: { active: true, birthDate: { not: null } } }),
  ]);
  return counts.reduce((sum, value) => sum + value, 0);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function auditEventState(row: EventRow) {
  return { title: row.title, date: dateText(row.date), type: row.type, note: row.note };
}

/** "+ Nuevo" (ADMIN). Sin duplicados vigentes (título + fecha + tipo). */
export async function createEvent(
  actor: TaskActor,
  input: CreateEventInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede crear eventos.');
  const date = resolveEventDate(input.date);
  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.event.create({
        data: {
          title: input.title,
          date: toDbDate(date),
          type: input.type,
          note: input.note ?? null,
        },
        select: eventSelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'event.created',
        entityType: 'Event',
        entityId: row.id,
        newState: auditEventState(row),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { event: serializeEvent(row, formatLocalDate(businessToday(now))) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EventDuplicateError();
    throw error;
  }
}

/** "✏️" (ADMIN). Solo eventos vigentes. */
export async function updateEvent(
  actor: TaskActor,
  eventId: string,
  input: UpdateEventInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede editar eventos.');
  const date = input.date !== undefined ? resolveEventDate(input.date) : undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.event.findFirst({
        where: { id: eventId, deletedAt: null },
        select: eventSelect,
      });
      if (!before) throw new EventNotFoundError();
      const after = await tx.event.update({
        where: { id: eventId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(date ? { date: toDbDate(date) } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        select: eventSelect,
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'event.updated',
        entityType: 'Event',
        entityId: eventId,
        previousState: auditEventState(before),
        newState: auditEventState(after),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { event: serializeEvent(after, formatLocalDate(businessToday(now))) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new EventDuplicateError();
    throw error;
  }
}

/** "✕" (ADMIN, "¿Eliminar este evento?"): anulación lógica; dos pedidos simultáneos anulan una sola vez. */
export async function deleteEvent(
  actor: TaskActor,
  eventId: string,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede eliminar eventos.');
  return prisma.$transaction(async (tx) => {
    const before = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: eventSelect,
    });
    if (!before) throw new EventNotFoundError();
    const { count } = await tx.event.updateMany({
      where: { id: eventId, deletedAt: null },
      data: { deletedAt: now, deletedByUserId: actor.userId },
    });
    if (count === 0) throw new EventNotFoundError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'event.deleted',
      entityType: 'Event',
      entityId: eventId,
      previousState: { ...auditEventState(before), deleted: false },
      newState: { deleted: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { event: { id: eventId, deletedAt: now.toISOString() } };
  });
}
