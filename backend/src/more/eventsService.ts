import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import type { EventType } from '../generated/prisma/enums';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EventBirthdayDerivedError,
  EventBirthdayDuplicateError,
  EventDuplicateError,
  EventNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../errors/AppError';
import { formatLocalDate, parseLocalDate, toLocalDate, type LocalDate } from '../lib/businessTime';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import {
  birthdayFallsOn,
  birthdayPersonKey,
  birthdayTitle,
  monthDayOf,
  upcomingBirthdays,
  type BirthdayInput,
  type BirthdayOrigin,
} from './birthdays';
import { FAMILY_RELATION_LABEL } from './familyService';
import type { createEventBodySchema, updateEventBodySchema } from './moreSchemas';

/**
 * 📅 Eventos (docs/BUSINESS_RULES.md §13–§14). Paridad: todos ven eventos y
 * cumpleaños; crear, editar y eliminar es solo de ADMIN. "Eliminar" es una
 * anulación lógica auditada (el prototipo borraba la fila). Los cumpleaños
 * derivados no son filas: se calculan al leer (ver `birthdays.ts`), llevan su
 * `origin` explícito y no se editan acá — se corrigen en su fuente (Mi perfil,
 * Mi familia, la ficha de la mascota). Un cumpleaños MANUAL (Event tipo
 * BIRTHDAY) sí es una fila: ADMIN lo crea, edita y anula, y no puede duplicar
 * a otro manual ni a uno derivado (Etapa 5F).
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
    origin: 'MANUAL' as const,
    id: row.id,
    title: row.title,
    date,
    type: row.type,
    note: row.note,
    daysUntil: dayNumber(date) - dayNumber(today),
  };
}

export type SerializedEvent = ReturnType<typeof serializeEvent>;

/** Quién mira el listado: decide solo el enlace a la fuente, nunca qué filas se ven. */
export type EventViewer = Pick<TaskActor, 'userId' | 'role' | 'employeeId'>;

/**
 * Referencia mínima para que el frontend navegue a la fuente de un cumpleaños
 * derivado: el propio perfil (o la propia familia), Datos del equipo (ADMIN,
 * lectura) o la ficha de la mascota. `null` = no hay nada que esa persona
 * pueda abrir (p. ej. la familia del ADMIN vista por un EMPLOYEE). No expone
 * ids de usuarios ni de empleados.
 */
export type BirthdaySourceRef =
  { kind: 'MY_PROFILE' } | { kind: 'TEAM_PROFILES' } | { kind: 'PET'; id: string } | null;

export function birthdaySourceRef(input: BirthdayInput, viewer: EventViewer): BirthdaySourceRef {
  switch (input.origin) {
    case 'USER_PROFILE':
    case 'USER_FAMILY':
      return input.ownerUserId === viewer.userId ? { kind: 'MY_PROFILE' } : null;
    case 'EMPLOYEE':
    case 'EMPLOYEE_CHILD':
      if (viewer.employeeId && input.employeeId === viewer.employeeId)
        return { kind: 'MY_PROFILE' };
      return viewer.role === 'ADMIN' ? { kind: 'TEAM_PROFILES' } : null;
    case 'ANIMAL':
      return { kind: 'PET', id: input.sourceId };
    case 'GLOBAL_RECURRING':
      return null;
  }
}

const RELATIONSHIP_LABEL: Record<string, string> = { familia: 'Familia' };

/**
 * Los cumpleaños vigentes de todas las fuentes, en cinco sentencias fijas en
 * paralelo (más una por relación incluida), sin importar cuántas filas haya:
 * nunca una consulta por cumpleaños. Omite fuentes inactivas: familiares o
 * globales desactivados, usuarios no activos, personas dadas de baja y
 * mascotas inactivas.
 */
export async function loadBirthdayInputs(): Promise<BirthdayInput[]> {
  const db = prisma;
  const [recurring, userProfiles, profiles, children, animals] = await Promise.all([
    db.recurringBirthday.findMany({
      where: { active: true, OR: [{ ownerUserId: null }, { owner: { status: 'ACTIVE' } }] },
      select: {
        id: true,
        personLabel: true,
        month: true,
        day: true,
        relationship: true,
        relation: true,
        ownerUserId: true,
      },
    }),
    // Solo usuarios SIN Employee: uno con ficha de equipo cumple desde `EmployeeProfile`.
    db.userProfile.findMany({
      where: { birthDate: { not: null }, user: { status: 'ACTIVE', employeeId: null } },
      select: { id: true, userId: true, displayName: true, birthDate: true },
    }),
    db.employeeProfile.findMany({
      where: { birthDate: { not: null }, employee: { active: true } },
      select: { employeeId: true, birthDate: true, employee: { select: { displayName: true } } },
    }),
    db.employeeChild.findMany({
      where: { birthDate: { not: null }, employee: { active: true } },
      select: {
        id: true,
        name: true,
        birthDate: true,
        employeeId: true,
        employee: { select: { displayName: true } },
      },
    }),
    db.animal.findMany({
      where: { active: true, birthDate: { not: null } },
      select: { id: true, name: true, birthDate: true },
    }),
  ]);
  const of = (
    origin: BirthdayOrigin,
    sourceId: string,
    name: string,
    date: Date,
    note: string,
    extra: Partial<BirthdayInput> = {},
  ): BirthdayInput => ({ origin, sourceId, name, note, ...monthDayOf(date), ...extra });
  return [
    ...recurring.map((row): BirthdayInput =>
      row.ownerUserId && row.relation
        ? {
            origin: 'USER_FAMILY',
            sourceId: row.id,
            name: row.personLabel,
            month: row.month,
            day: row.day,
            note: FAMILY_RELATION_LABEL[row.relation],
            ownerUserId: row.ownerUserId,
          }
        : {
            origin: 'GLOBAL_RECURRING',
            sourceId: row.id,
            name: row.personLabel,
            month: row.month,
            day: row.day,
            note: row.relationship
              ? (RELATIONSHIP_LABEL[row.relationship] ?? row.relationship)
              : 'Familia',
          },
    ),
    ...userProfiles.map((row) => ({
      origin: 'USER_PROFILE' as const,
      sourceId: row.id,
      name: row.displayName,
      fallbackTitle: 'Cumpleaños del administrador',
      note: 'Administración',
      ownerUserId: row.userId,
      ...monthDayOf(row.birthDate as Date),
    })),
    ...profiles.map((row) =>
      of('EMPLOYEE', row.employeeId, row.employee.displayName, row.birthDate as Date, 'Equipo', {
        employeeId: row.employeeId,
      }),
    ),
    ...children.map((row) =>
      of(
        'EMPLOYEE_CHILD',
        row.id,
        row.name,
        row.birthDate as Date,
        `Hijo/a de ${row.employee.displayName}`,
        { employeeId: row.employeeId },
      ),
    ),
    ...animals.map((row) => of('ANIMAL', row.id, row.name, row.birthDate as Date, 'Mascota')),
  ];
}

function birthdayItems(inputs: readonly BirthdayInput[], today: LocalDate, viewer: EventViewer) {
  return upcomingBirthdays(inputs, today).map((birthday) => ({
    kind: 'birthday' as const,
    origin: birthday.origin,
    id: `${birthday.origin.toLowerCase()}:${birthday.sourceId}`,
    title: birthdayTitle(birthday),
    date: birthday.date,
    type: 'BIRTHDAY' as const,
    note: birthday.note,
    daysUntil: birthday.daysUntil,
    sourceRef: birthdaySourceRef(birthday, viewer),
  }));
}

/**
 * Próximos (eventos desde hoy + cumpleaños derivados, por fecha) y Pasados
 * (paginados, del más reciente al más antiguo), con el filtro de tipo del
 * prototipo. Sentencias fijas, independientes del número de filas.
 */
export async function listEvents(
  viewer: EventViewer,
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
    ...birthdayItems(birthdayInputs, today, viewer),
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

/** Solo los próximos eventos/cumpleaños para Inicio; evita cargar y contar pasados. */
export async function listUpcomingEvents(viewer: EventViewer, limit: number, now = new Date()) {
  const today = businessToday(now);
  const todayText = formatLocalDate(today);
  const todayDb = toDbDate(today);
  const [upcoming, birthdayInputs] = await Promise.all([
    prisma.event.findMany({
      where: { deletedAt: null, date: { gte: todayDb } },
      select: eventSelect,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: Math.max(limit, 1),
    }),
    loadBirthdayInputs(),
  ]);
  return [
    ...upcoming.map((row) => serializeEvent(row, todayText)),
    ...birthdayItems(birthdayInputs, today, viewer),
  ]
    .sort((a, b) => a.daysUntil - b.daysUntil || a.title.localeCompare(b.title, 'es'))
    .slice(0, limit);
}

/** Próximos eventos (desde hoy) + cumpleaños vigentes — la tarjeta de Más. Solo conteos. */
export async function countUpcomingEvents(now = new Date()) {
  const todayDb = toDbDate(businessToday(now));
  const counts = await Promise.all([
    prisma.event.count({ where: { deletedAt: null, date: { gte: todayDb } } }),
    prisma.recurringBirthday.count({
      where: { active: true, OR: [{ ownerUserId: null }, { owner: { status: 'ACTIVE' } }] },
    }),
    prisma.userProfile.count({
      where: { birthDate: { not: null }, user: { status: 'ACTIVE', employeeId: null } },
    }),
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

/**
 * Antes de guardar un cumpleaños MANUAL: (1) otro manual vigente de la misma
 * persona el mismo día → 409; (2) un cumpleaños derivado activo de la misma
 * persona que cae ese día (29/02 → 01/03 en años no bisiestos) → 409 y se
 * indica editarlo desde su perfil. La persona se compara por nombre sin
 * mayúsculas ni espacios extra (`birthdayPersonKey`); dos personas distintas
 * con igual nombre y fecha solo se distinguen cambiando el título (riesgo
 * documentado: no hay constraint de base para esto). Lecturas fuera de la
 * transacción: una carrera entre dos altas idénticas la frena el índice único.
 */
async function assertManualBirthdayIsUnique(
  title: string,
  date: LocalDate,
  exceptEventId?: string,
): Promise<void> {
  const person = birthdayPersonKey(title);
  const [sameDay, derived] = await Promise.all([
    prisma.event.findMany({
      where: {
        type: 'BIRTHDAY',
        deletedAt: null,
        date: toDbDate(date),
        ...(exceptEventId ? { id: { not: exceptEventId } } : {}),
      },
      select: { title: true },
    }),
    loadBirthdayInputs(),
  ]);
  if (sameDay.some((row) => birthdayPersonKey(row.title) === person)) {
    throw new EventBirthdayDuplicateError();
  }
  if (
    derived.some(
      (input) =>
        input.name !== null &&
        birthdayPersonKey(input.name) === person &&
        birthdayFallsOn(input, date),
    )
  ) {
    throw new EventBirthdayDerivedError();
  }
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
  if (input.type === 'BIRTHDAY') await assertManualBirthdayIsUnique(input.title, date);
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
  if (input.type === 'BIRTHDAY' || input.type === undefined) {
    // El chequeo necesita el estado final (título, fecha y tipo tras el cambio).
    const current = await prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { title: true, date: true, type: true },
    });
    if (!current) throw new EventNotFoundError();
    const finalType = input.type ?? current.type;
    if (finalType === 'BIRTHDAY') {
      await assertManualBirthdayIsUnique(
        input.title ?? current.title,
        date ?? (parseLocalDate(dateText(current.date)) as LocalDate),
        eventId,
      );
    }
  }
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
