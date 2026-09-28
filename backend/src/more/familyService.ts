import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import type { FamilyRelation } from '../generated/prisma/enums';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  FamilyMemberDuplicateError,
  FamilyMemberNotFoundError,
  FamilyMemberSeededError,
  FamilyUsesEmployeeProfileError,
  ValidationError,
} from '../errors/AppError';
import {
  compareLocalDates,
  parseLocalDate,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { prisma } from '../lib/prisma';
import { computePetAge } from '../pets/petDates';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import type {
  createFamilyMemberBodySchema,
  updateFamilyMemberBodySchema,
  updatePersonalProfileBodySchema,
} from './moreSchemas';

/**
 * 👤 Mi perfil personal y 👨‍👩‍👧‍👦 Mi familia (Etapa 5F) de un usuario SIN
 * `Employee` vinculado — hoy, el ADMIN. No se le crea un Employee ficticio: su
 * fecha propia vive en `UserProfile` y sus familiares son `RecurringBirthday`
 * con `ownerUserId` (Vicky y Felicitas son esas mismas filas del seed). El
 * propietario sale SIEMPRE de la sesión: ningún endpoint acepta `userId`, y un
 * id ajeno responde lo mismo que uno inexistente (404). Un usuario con ficha de
 * equipo sigue con `EmployeeProfile`/`EmployeeChild` (profileService.ts) y no
 * puede cargar familia acá (una sola fuente por cumpleaños). Los cumpleaños se
 * derivan en Eventos al leer: ninguna escritura crea ni borra filas `Event`.
 */

type PersonalProfileInput = z.infer<typeof updatePersonalProfileBodySchema>;
type CreateFamilyMemberInput = z.infer<typeof createFamilyMemberBodySchema>;
type UpdateFamilyMemberInput = z.infer<typeof updateFamilyMemberBodySchema>;

/** Nota visible en Eventos para un familiar según su relación. */
export const FAMILY_RELATION_LABEL: Record<FamilyRelation, string> = {
  PARTNER: 'Pareja',
  CHILD: 'Hijo/a',
  FAMILY: 'Familia',
  OTHER: 'Otro',
};

const pad = (value: number) => String(value).padStart(2, '0');
const dateText = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const toDbDate = (date: LocalDate): Date => new Date(Date.UTC(date.year, date.month - 1, date.day));
const businessToday = (now: Date) => toLocalDate(now, config.businessTimeZone);

/** El propietario de Mi familia: el usuario de la sesión, si no tiene ficha de equipo. */
function requirePersonalOwner(actor: TaskActor): string {
  if (actor.employeeId) throw new FamilyUsesEmployeeProfileError();
  return actor.userId;
}

export interface FamilyBirthDate {
  month: number;
  day: number;
  /** Año real o null si no se conoce — nunca uno de relleno. */
  year: number | null;
}

/**
 * `YYYY-MM-DD` (año conocido: fecha real, no futura, desde 1900) o `--MM-DD`
 * (sin año: día y mes reales; el 29/02 se admite y se festeja el 01/03 en años
 * no bisiestos).
 */
export function parseFamilyBirthDate(text: string, today: LocalDate): FamilyBirthDate {
  if (text.startsWith('--')) {
    const local = parseLocalDate(`2000${text.slice(1)}`); // 2000 es bisiesto: admite 29/02
    if (!local) throw new ValidationError('La fecha de nacimiento no es válida.');
    return { month: local.month, day: local.day, year: null };
  }
  const local = parseLocalDate(text);
  if (!local || local.year < 1900)
    throw new ValidationError('La fecha de nacimiento no es válida.');
  if (compareLocalDates(local, today) > 0) {
    throw new ValidationError('La fecha de nacimiento no puede ser futura.');
  }
  return { month: local.month, day: local.day, year: local.year };
}

export const formatFamilyBirthDate = (date: FamilyBirthDate): string =>
  `${date.year === null ? '-' : String(date.year).padStart(4, '0')}-${pad(date.month)}-${pad(date.day)}`;

/** Fecha propia: hoy o pasada, desde 1900 (mismo criterio que Mi perfil del equipo). */
function resolveOwnBirthDate(text: string | null, now: Date): Date | null {
  if (text === null) return null;
  const local = parseLocalDate(text);
  if (!local || local.year < 1900)
    throw new ValidationError('La fecha de nacimiento no es válida.');
  if (compareLocalDates(local, businessToday(now)) > 0) {
    throw new ValidationError('La fecha de nacimiento no puede ser futura.');
  }
  return toDbDate(local);
}

// ── 🎂 Mi cumpleaños ──────────────────────────────────────────────────────

const personalSelect = { displayName: true, birthDate: true } as const;
type PersonalRow = Prisma.UserProfileGetPayload<{ select: typeof personalSelect }>;

const serializePersonal = (row: PersonalRow | null) => ({
  kind: 'personal' as const,
  profile: {
    displayName: row?.displayName ?? null,
    birthDate: dateText(row?.birthDate ?? null),
  },
});

export async function getPersonalProfile(actor: TaskActor) {
  const userId = requirePersonalOwner(actor);
  const row = await prisma.userProfile.findUnique({ where: { userId }, select: personalSelect });
  return serializePersonal(row);
}

/** "Guardar": upsert 1:1 del perfil personal. La auditoría lista campos, nunca valores. */
export async function updatePersonalProfile(
  actor: TaskActor,
  input: PersonalProfileInput,
  meta: RequestMeta,
  now = new Date(),
) {
  const userId = requirePersonalOwner(actor);
  const data = {
    displayName: input.displayName,
    birthDate: resolveOwnBirthDate(input.birthDate, now),
  };
  const saved = await prisma.$transaction(async (tx) => {
    const before = await tx.userProfile.findUnique({ where: { userId }, select: personalSelect });
    const after = await tx.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: personalSelect,
    });
    const changed = [
      (before?.displayName ?? null) !== data.displayName ? 'displayName' : null,
      dateText(before?.birthDate ?? null) !== dateText(data.birthDate) ? 'birthDate' : null,
    ].filter((field): field is string => field !== null);
    if (changed.length) {
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'profile.personal_updated',
        entityType: 'UserProfile',
        entityId: userId,
        newState: { changedFields: changed },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return after;
  });
  return serializePersonal(saved);
}

// ── 👨‍👩‍👧‍👦 Mi familia ───────────────────────────────────────────────────────

const memberSelect = {
  id: true,
  slug: true,
  personLabel: true,
  relation: true,
  month: true,
  day: true,
  birthYear: true,
  active: true,
} as const;
type MemberRow = Prisma.RecurringBirthdayGetPayload<{ select: typeof memberSelect }>;

export function serializeFamilyMember(row: MemberRow, today: LocalDate) {
  const birth = { month: row.month, day: row.day, year: row.birthYear };
  const age =
    row.birthYear === null
      ? null
      : computePetAge({ year: row.birthYear, month: row.month, day: row.day }, today);
  return {
    id: row.id,
    name: row.personLabel,
    relation: row.relation ?? 'FAMILY',
    birthDate: formatFamilyBirthDate(birth),
    active: row.active,
    age: age ? { years: age.years, months: age.months } : null,
    /** Viene de los datos originales: se desactiva, no se elimina. */
    seeded: row.slug !== null,
  };
}

export type SerializedFamilyMember = ReturnType<typeof serializeFamilyMember>;

export async function listMyFamily(actor: TaskActor, now = new Date()) {
  const ownerUserId = requirePersonalOwner(actor);
  const rows = await prisma.recurringBirthday.findMany({
    where: { ownerUserId },
    select: memberSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const today = businessToday(now);
  return { family: rows.map((row) => serializeFamilyMember(row, today)) };
}

/**
 * Serializa las escrituras de UNA familia (bloquea la fila del propietario
 * dentro de la transacción): dos altas simultáneas idénticas no pueden pasar
 * ambas el chequeo de duplicados. Una sola sentencia, sin tocar la fila.
 */
async function lockOwner(tx: Prisma.TransactionClient, ownerUserId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${ownerUserId}::uuid FOR UPDATE`;
}

/**
 * Doble carga = mismo nombre (sin distinguir mayúsculas) y mismo día/mes, con
 * el mismo año o sin año en alguno de los dos. Un homónimo con otra fecha es
 * otra persona y se permite. Cuenta también los inactivos (se reactivan).
 */
async function assertNoDuplicateMember(
  tx: Prisma.TransactionClient,
  ownerUserId: string,
  name: string,
  birth: FamilyBirthDate,
  exceptId?: string,
): Promise<void> {
  const clash = await tx.recurringBirthday.findFirst({
    where: {
      ownerUserId,
      personLabel: { equals: name, mode: 'insensitive' },
      month: birth.month,
      day: birth.day,
      ...(birth.year === null ? {} : { OR: [{ birthYear: null }, { birthYear: birth.year }] }),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new FamilyMemberDuplicateError();
}

export type CreateFamilyMemberResult =
  | { kind: 'created'; body: { member: SerializedFamilyMember } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/** "+ Agregar familiar". Acepta `Idempotency-Key` (doble envío = una sola fila). */
export async function createFamilyMember(
  actor: TaskActor,
  input: CreateFamilyMemberInput,
  meta: RequestMeta,
  idempotencyKey?: string,
  now = new Date(),
): Promise<CreateFamilyMemberResult> {
  const ownerUserId = requirePersonalOwner(actor);
  const today = businessToday(now);
  const birth = parseFamilyBirthDate(input.birthDate, today);
  const write = async (tx: Prisma.TransactionClient) => {
    await lockOwner(tx, ownerUserId);
    await assertNoDuplicateMember(tx, ownerUserId, input.name, birth);
    const row = await tx.recurringBirthday.create({
      data: {
        ownerUserId,
        relation: input.relation,
        personLabel: input.name,
        month: birth.month,
        day: birth.day,
        birthYear: birth.year,
      },
      select: memberSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'family.member_created',
      entityType: 'RecurringBirthday',
      entityId: row.id,
      newState: { ownerUserId, relation: input.relation },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { member: serializeFamilyMember(row, today) };
  };
  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  const endpoint = 'POST /me/family';
  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([
      endpoint,
      input.name,
      input.relation,
      formatFamilyBirthDate(birth),
    ]),
    status: 201,
    run: write,
  });
}

/** Busca el familiar SOLO dentro de la familia de la sesión: uno ajeno es 404. */
async function findOwnMember(tx: Prisma.TransactionClient, ownerUserId: string, id: string) {
  const row = await tx.recurringBirthday.findFirst({
    where: { id, ownerUserId },
    select: memberSelect,
  });
  if (!row) throw new FamilyMemberNotFoundError();
  return row;
}

/** "Editar": nombre, relación y/o fecha. La auditoría lista campos, nunca valores. */
export async function updateFamilyMember(
  actor: TaskActor,
  memberId: string,
  input: UpdateFamilyMemberInput,
  meta: RequestMeta,
  now = new Date(),
) {
  const ownerUserId = requirePersonalOwner(actor);
  const today = businessToday(now);
  const birth = input.birthDate !== undefined ? parseFamilyBirthDate(input.birthDate, today) : null;
  return prisma.$transaction(async (tx) => {
    await lockOwner(tx, ownerUserId);
    const before = await findOwnMember(tx, ownerUserId, memberId);
    const next = {
      personLabel: input.name ?? before.personLabel,
      relation: input.relation ?? before.relation ?? 'FAMILY',
      month: birth?.month ?? before.month,
      day: birth?.day ?? before.day,
      birthYear: birth ? birth.year : before.birthYear,
    };
    const changed = [
      next.personLabel !== before.personLabel ? 'name' : null,
      next.relation !== before.relation ? 'relation' : null,
      next.month !== before.month || next.day !== before.day || next.birthYear !== before.birthYear
        ? 'birthDate'
        : null,
    ].filter((field): field is string => field !== null);
    if (changed.length === 0) return { member: serializeFamilyMember(before, today) };
    if (changed.includes('name') || changed.includes('birthDate')) {
      await assertNoDuplicateMember(
        tx,
        ownerUserId,
        next.personLabel,
        { month: next.month, day: next.day, year: next.birthYear },
        memberId,
      );
    }
    const after = await tx.recurringBirthday.update({
      where: { id: memberId },
      data: next,
      select: memberSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'family.member_updated',
      entityType: 'RecurringBirthday',
      entityId: memberId,
      newState: { changedFields: changed },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { member: serializeFamilyMember(after, today) };
  });
}

/** Desactivar (deja de aparecer en Eventos, se conserva) / reactivar. Repetir el estado no audita. */
export async function setFamilyMemberActive(
  actor: TaskActor,
  memberId: string,
  active: boolean,
  meta: RequestMeta,
  now = new Date(),
) {
  const ownerUserId = requirePersonalOwner(actor);
  const today = businessToday(now);
  return prisma.$transaction(async (tx) => {
    const before = await findOwnMember(tx, ownerUserId, memberId);
    if (before.active === active) return { member: serializeFamilyMember(before, today) };
    const { count } = await tx.recurringBirthday.updateMany({
      where: { id: memberId, ownerUserId, active: !active },
      data: { active },
    });
    if (count === 0) throw new FamilyMemberNotFoundError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: active ? 'family.member_reactivated' : 'family.member_deactivated',
      entityType: 'RecurringBirthday',
      entityId: memberId,
      previousState: { active: before.active },
      newState: { active },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { member: serializeFamilyMember({ ...before, active }, today) };
  });
}

/**
 * Eliminar definitivamente un familiar cargado por error. No tiene dependencias
 * (su cumpleaños es derivado: no hay filas `Event` que borrar). Los familiares
 * de los datos originales (con `slug` de seed, como Vicky y Felicitas) solo se
 * desactivan. Auditoría con snapshot mínimo (nombre y relación, sin fecha)
 * ANTES del borrado condicionado; dos DELETE simultáneos → 204 + 404.
 */
export async function deleteFamilyMember(actor: TaskActor, memberId: string, meta: RequestMeta) {
  const ownerUserId = requirePersonalOwner(actor);
  await prisma.$transaction(async (tx) => {
    const row = await findOwnMember(tx, ownerUserId, memberId);
    if (row.slug !== null) throw new FamilyMemberSeededError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'family.member_deleted',
      entityType: 'RecurringBirthday',
      entityId: memberId,
      previousState: { ownerUserId, name: row.personLabel, relation: row.relation },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    const { count } = await tx.recurringBirthday.deleteMany({
      where: { id: memberId, ownerUserId, slug: null },
    });
    if (count === 0) throw new FamilyMemberNotFoundError();
  });
}
