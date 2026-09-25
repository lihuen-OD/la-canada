import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import { ChildNotFoundError, EmployeeLinkRequiredError, ValidationError } from '../errors/AppError';
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
import type { createChildBodySchema, updateProfileBodySchema } from './moreSchemas';

/**
 * 👤 Mi perfil (docs/BUSINESS_RULES.md §15–§16): cada persona carga SUS datos
 * personales, contacto de emergencia e hijos. La persona sale siempre de la
 * sesión (el prototipo usaba `currentUser.id`); no existe forma de escribir
 * el perfil de otra persona. Las auditorías registran qué campos cambiaron,
 * nunca sus valores (son datos personales sensibles, docs/SECURITY.md §6).
 * Los cumpleaños resultantes se derivan en Eventos (no se crean filas).
 */

type UpdateProfileInput = z.infer<typeof updateProfileBodySchema>;
type CreateChildInput = z.infer<typeof createChildBodySchema>;

const dateText = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const toDbDate = (date: LocalDate): Date => new Date(Date.UTC(date.year, date.month - 1, date.day));
const businessToday = (now: Date) => toLocalDate(now, config.businessTimeZone);

function requireEmployee(actor: TaskActor): string {
  if (!actor.employeeId) throw new EmployeeLinkRequiredError();
  return actor.employeeId;
}

/** Hoy o una fecha pasada, nunca futura. */
function resolveBirthDate(text: string | null, now: Date): Date | null {
  if (text === null) return null;
  const local = parseLocalDate(text);
  if (!local || local.year < 1900)
    throw new ValidationError('La fecha de nacimiento no es válida.');
  if (compareLocalDates(local, businessToday(now)) > 0) {
    throw new ValidationError('La fecha de nacimiento no puede ser futura.');
  }
  return toDbDate(local);
}

export function serializeChild(
  child: { id: string; name: string; birthDate: Date | null },
  today: LocalDate,
) {
  const birth = child.birthDate ? parseLocalDate(dateText(child.birthDate) as string) : null;
  const age = birth ? computePetAge(birth, today) : null;
  return {
    id: child.id,
    name: child.name,
    birthDate: dateText(child.birthDate),
    age: age ? { years: age.years, months: age.months } : null,
  };
}

const profileSelect = {
  fullLegalName: true,
  birthDate: true,
  maritalStatus: true,
  phone: true,
  taxId: true,
  healthInsurance: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
} as const;
type ProfileRow = Prisma.EmployeeProfileGetPayload<{ select: typeof profileSelect }>;
type ProfileField = keyof ProfileRow;
const PROFILE_FIELDS = Object.keys(profileSelect) as ProfileField[];

const serializeProfile = (row: ProfileRow | null) =>
  row ? { ...row, birthDate: dateText(row.birthDate) } : null;

export async function getMyProfile(actor: TaskActor, now = new Date()) {
  const employeeId = requireEmployee(actor);
  const [employee, profile, children] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, displayName: true, role: true, colorHex: true },
    }),
    prisma.employeeProfile.findUnique({ where: { employeeId }, select: profileSelect }),
    prisma.employeeChild.findMany({
      where: { employeeId },
      select: { id: true, name: true, birthDate: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  if (!employee) throw new EmployeeLinkRequiredError();
  const today = businessToday(now);
  return {
    employee,
    profile: serializeProfile(profile),
    children: children.map((child) => serializeChild(child, today)),
  };
}

/** "Guardar mis datos": upsert del formulario completo. */
export async function updateMyProfile(
  actor: TaskActor,
  input: UpdateProfileInput,
  meta: RequestMeta,
  now = new Date(),
) {
  const employeeId = requireEmployee(actor);
  const data = { ...input, birthDate: resolveBirthDate(input.birthDate, now) };
  await prisma.$transaction(async (tx) => {
    const before = await tx.employeeProfile.findUnique({
      where: { employeeId },
      select: profileSelect,
    });
    await tx.employeeProfile.upsert({
      where: { employeeId },
      create: { employeeId, ...data },
      update: data,
    });
    const changed = PROFILE_FIELDS.filter((field) => {
      const previous = before?.[field] ?? null;
      const next = data[field] ?? null;
      return previous instanceof Date || next instanceof Date
        ? dateText(previous as Date | null) !== dateText(next as Date | null)
        : previous !== next;
    });
    if (changed.length) {
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'profile.updated',
        entityType: 'EmployeeProfile',
        entityId: employeeId,
        newState: { changedFields: changed },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
  });
  return getMyProfile(actor, now);
}

export type AddChildResult =
  | { kind: 'created'; body: { child: ReturnType<typeof serializeChild> } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/** "+ Agregar" hijo (nombre y fecha opcional). Acepta `Idempotency-Key`. */
export async function addMyChild(
  actor: TaskActor,
  input: CreateChildInput,
  meta: RequestMeta,
  idempotencyKey?: string,
  now = new Date(),
): Promise<AddChildResult> {
  const employeeId = requireEmployee(actor);
  const birthDate = resolveBirthDate(input.birthDate, now);
  const write = async (tx: Prisma.TransactionClient) => {
    const child = await tx.employeeChild.create({
      data: { employeeId, name: input.name, birthDate },
      select: { id: true, name: true, birthDate: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'profile.child_added',
      entityType: 'EmployeeChild',
      entityId: child.id,
      newState: { employeeId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { child: serializeChild(child, businessToday(now)) };
  };
  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  const endpoint = 'POST /me/children';
  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([endpoint, input.name, dateText(birthDate)]),
    status: 201,
    run: write,
  });
}

/**
 * "✕" de un hijo ("¿Eliminar este hijo del registro?"). Es un dato personal de
 * un menor sin historia operativa asociada: se elimina de verdad, como en el
 * prototipo; la auditoría conserva solo identificadores.
 */
export async function removeMyChild(actor: TaskActor, childId: string, meta: RequestMeta) {
  const employeeId = requireEmployee(actor);
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.employeeChild.deleteMany({ where: { id: childId, employeeId } });
    if (count === 0) throw new ChildNotFoundError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'profile.child_removed',
      entityType: 'EmployeeChild',
      entityId: childId,
      previousState: { employeeId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });
  return { child: { id: childId, removed: true } };
}
