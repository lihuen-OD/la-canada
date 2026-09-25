import type { z } from 'zod';
import type { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import { EmployeeNotFoundError, ForbiddenError } from '../errors/AppError';
import { toLocalDate } from '../lib/businessTime';
import { prisma } from '../lib/prisma';
import type { RequestMeta, TaskActor } from '../tasks/tasksService';
import { normalizeUsername } from '../utils/username';
import type { createEmployeeBodySchema, updateEmployeeBodySchema } from './moreSchemas';
import { serializeChild } from './profileService';

/**
 * ⚙️ Configuración → 👥 Personas y 👤 Datos del equipo (solo ADMIN, como el
 * prototipo). Alta = `Employee` + su cuenta `User` EMPLOYEE en
 * `PENDING_ACTIVATION`, sin PIN (el ADMIN lo asigna con 🔑, igual que en
 * Usuarios). "Baja" es lógica (`active: false`) y además revoca las sesiones
 * de esa persona: el prototipo solo dejaba ingresar a personas activas.
 * Nunca se borra un empleado (sus tareas, movimientos e historial lo
 * referencian). Los datos personales son de solo lectura para el ADMIN: los
 * carga cada persona en Mi perfil.
 */

type CreateEmployeeInput = z.infer<typeof createEmployeeBodySchema>;
type UpdateEmployeeInput = z.infer<typeof updateEmployeeBodySchema>;

function requireAdmin(actor: TaskActor): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError('Solo un administrador gestiona personas.');
}

const employeeSelect = {
  id: true,
  displayName: true,
  role: true,
  colorHex: true,
  active: true,
  user: { select: { id: true, status: true } },
} as const;
type EmployeeRow = Prisma.EmployeeGetPayload<{ select: typeof employeeSelect }>;

function serializeEmployee(row: EmployeeRow) {
  return {
    id: row.id,
    displayName: row.displayName,
    role: row.role,
    colorHex: row.colorHex,
    active: row.active,
    /** `ACTIVE`/`SUSPENDED`/`DEACTIVATED` ya tuvieron PIN; `PENDING_ACTIVATION`, no (CHECK de `users`). */
    account: row.user
      ? {
          userId: row.user.id,
          status: row.user.status,
          hasPin: row.user.status !== 'PENDING_ACTIVATION',
        }
      : null,
  };
}

export type SerializedEmployee = ReturnType<typeof serializeEmployee>;

export async function listEmployees(actor: TaskActor) {
  requireAdmin(actor);
  const rows = await prisma.employee.findMany({
    select: employeeSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return { employees: rows.map(serializeEmployee) };
}

/** Clave estable libre (`coke`, `coke-2`, …) a partir del nombre, para `Employee.code` y `User.username`. */
async function freeIdentifier(tx: Prisma.TransactionClient, displayName: string): Promise<string> {
  const base = normalizeUsername(displayName) || 'persona';
  const [codes, usernames] = await Promise.all([
    tx.employee.findMany({ where: { code: { startsWith: base } }, select: { code: true } }),
    tx.user.findMany({ where: { username: { startsWith: base } }, select: { username: true } }),
  ]);
  const taken = new Set([...codes.map((row) => row.code), ...usernames.map((row) => row.username)]);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** "+ Agregar" persona: nombre, rol y color. Nace sin PIN (pendiente de activación). */
export async function createEmployee(
  actor: TaskActor,
  input: CreateEmployeeInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const identifier = await freeIdentifier(tx, input.displayName);
    const employee = await tx.employee.create({
      data: {
        code: identifier,
        displayName: input.displayName,
        role: input.role,
        colorHex: input.colorHex,
      },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: {
        username: identifier,
        role: 'EMPLOYEE',
        status: 'PENDING_ACTIVATION',
        employeeId: employee.id,
      },
      select: { id: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee.id,
      newState: { ...input, userId: user.id, status: 'PENDING_ACTIVATION' },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    const row = await tx.employee.findUniqueOrThrow({
      where: { id: employee.id },
      select: employeeSelect,
    });
    return { employee: serializeEmployee(row) };
  });
}

/** "✏️": nombre, rol y color. */
export async function updateEmployee(
  actor: TaskActor,
  employeeId: string,
  input: UpdateEmployeeInput,
  meta: RequestMeta,
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const before = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { displayName: true, role: true, colorHex: true },
    });
    if (!before) throw new EmployeeNotFoundError();
    const row = await tx.employee.update({
      where: { id: employeeId },
      data: input,
      select: employeeSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'employee.updated',
      entityType: 'Employee',
      entityId: employeeId,
      previousState: before,
      newState: { displayName: row.displayName, role: row.role, colorHex: row.colorHex },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { employee: serializeEmployee(row) };
  });
}

/** "Baja" / "Activar". La baja revoca las sesiones abiertas de esa persona. */
export async function setEmployeeActive(
  actor: TaskActor,
  employeeId: string,
  active: boolean,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.employee.findUnique({
      where: { id: employeeId },
      select: { active: true, user: { select: { id: true } } },
    });
    if (!existing) throw new EmployeeNotFoundError();
    const { count } = await tx.employee.updateMany({
      where: { id: employeeId, active: !active },
      data: { active },
    });
    let revokedSessions = 0;
    if (count > 0) {
      if (!active && existing.user) {
        ({ count: revokedSessions } = await tx.session.updateMany({
          where: { userId: existing.user.id, revokedAt: null },
          data: { revokedAt: now },
        }));
      }
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: active ? 'employee.reactivated' : 'employee.deactivated',
        entityType: 'Employee',
        entityId: employeeId,
        previousState: { active: !active },
        newState: { active, revokedSessions },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    const row = await tx.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: employeeSelect,
    });
    return { employee: serializeEmployee(row) };
  });
}

const dateText = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/**
 * "Datos del equipo": personas activas con su ficha e hijos (lectura). Un
 * perfil es "completo" si tiene fecha de nacimiento, teléfono o CUIL
 * (`tiene = d && (d.fechaNac||d.tel||d.cuil)` del prototipo).
 */
export async function listTeamProfiles(
  actor: TaskActor,
  filter: 'all' | 'complete' | 'incomplete',
  now = new Date(),
) {
  requireAdmin(actor);
  const today = toLocalDate(now, config.businessTimeZone);
  const rows = await prisma.employee.findMany({
    where: { active: true },
    select: {
      id: true,
      displayName: true,
      role: true,
      colorHex: true,
      profile: {
        select: {
          fullLegalName: true,
          birthDate: true,
          maritalStatus: true,
          phone: true,
          taxId: true,
          healthInsurance: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
        },
      },
      children: {
        select: { id: true, name: true, birthDate: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const team = rows.map((row) => {
    const profile = row.profile;
    const complete = Boolean(profile && (profile.birthDate || profile.phone || profile.taxId));
    return {
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      colorHex: row.colorHex,
      complete,
      profile: profile ? { ...profile, birthDate: dateText(profile.birthDate) } : null,
      children: row.children.map((child) => serializeChild(child, today)),
    };
  });
  return {
    team: team.filter((member) =>
      filter === 'all' ? true : filter === 'complete' ? member.complete : !member.complete,
    ),
  };
}
