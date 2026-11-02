import { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { recordAuditLog } from '../auth/auditLog';
import { resolveVisibleName } from '../auth/authService';
import type { AuthContext } from '../auth/types';
import {
  ForbiddenError,
  GardenParticipantAlreadyActiveError,
  GardenParticipantHasActivitiesError,
  GardenParticipantNotFoundError,
  ValidationError,
} from '../errors/AppError';

/**
 * 🥬 Huerta — participantes (docs/BUSINESS_RULES.md, "🥬 Huerta"). Un
 * participante es un USUARIO existente (empleado o administrador), una sola
 * vez por persona (`user_id` único): la identidad es el usuario, nunca el
 * nombre. El módulo arranca sin participantes; solo un ADMIN los agrega o
 * desactiva. Participar no cambia rol ni permisos globales, y nada de esto
 * crea usuarios, empleados ni tareas.
 */

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Actor de una request de Huerta: rol de la sesión y su participación
 * ACTIVA (o `null`: no participa, o su participación está desactivada).
 * Leída de la base en cada request, nunca del cliente.
 */
export interface GardenActor {
  userId: string;
  role: AuthContext['role'];
  participantId: string | null;
}

export async function resolveGardenActor(auth: AuthContext): Promise<GardenActor> {
  const participant = await prisma.kitchenGardenParticipant.findUnique({
    where: { userId: auth.userId },
    select: { id: true, active: true },
  });
  return {
    userId: auth.userId,
    role: auth.role,
    participantId: participant?.active ? participant.id : null,
  };
}

export function requireGardenAdmin(actor: GardenActor, message?: string): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError(message);
}

/** Lo público de un usuario: su nombre visible (Employee → Mi perfil → «Administrador») y color. */
const userPublicSelect = {
  role: true,
  status: true,
  employee: { select: { displayName: true, colorHex: true, role: true } },
  personalProfile: { select: { displayName: true } },
} as const;

type UserPublicRow = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

/** Persona visible en Huerta: nunca `username` ni otros datos de la cuenta. */
export interface GardenPerson {
  id: string;
  displayName: string;
  colorHex: string | null;
}

function personOf(id: string, user: UserPublicRow): GardenPerson {
  return {
    id,
    displayName: resolveVisibleName(user),
    colorHex: user.employee?.colorHex ?? null,
  };
}

/** Rótulo secundario: el puesto del empleado o «Administrador». */
const roleLabelOf = (user: UserPublicRow) =>
  user.employee?.role ?? (user.role === 'ADMIN' ? 'Administrador' : 'Empleado');

const participantSelect = {
  id: true,
  active: true,
  createdAt: true,
  user: { select: userPublicSelect },
} as const;

type ParticipantRow = Prisma.KitchenGardenParticipantGetPayload<{
  select: typeof participantSelect;
}>;

export interface GardenParticipantEntry {
  person: GardenPerson;
  active: boolean;
  roleLabel: string;
  /** Si la cuenta sigue ACTIVE (una suspendida no puede ingresar, pero su historia queda). */
  userActive: boolean;
}

function entryOf(row: ParticipantRow): GardenParticipantEntry {
  return {
    person: personOf(row.id, row.user),
    active: row.active,
    roleLabel: roleLabelOf(row.user),
    userActive: row.user.status === 'ACTIVE',
  };
}

/**
 * Directorio de TODOS los participantes (activos o no) con su nombre real,
 * en una sentencia: lo usan los listados, el historial y Desempeño para
 * nombrar responsables y ejecutores sin una consulta por fila. Son pocas filas.
 */
export async function loadParticipantDirectory(
  client: Pick<Prisma.TransactionClient, 'kitchenGardenParticipant'> = prisma,
): Promise<Map<string, GardenParticipantEntry>> {
  const rows = await client.kitchenGardenParticipant.findMany({
    select: participantSelect,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return new Map(rows.map((row) => [row.id, entryOf(row)]));
}

/** `GET /kitchen-garden/participants` — todos los autenticados (consulta). */
export async function listGardenParticipants() {
  const directory = await loadParticipantDirectory();
  return {
    participants: [...directory.values()].map((entry) => ({
      ...entry.person,
      active: entry.active,
      roleLabel: entry.roleLabel,
      userActive: entry.userActive,
    })),
  };
}

/**
 * `GET /kitchen-garden/participants/candidates` (ADMIN): usuarios ACTIVE que
 * hoy no participan, cada persona una sola vez (un User, con o sin
 * Employee). Quien tuvo una participación desactivada aparece para
 * reactivarla (misma fila: su historia sigue).
 */
export async function listGardenCandidates(actor: GardenActor) {
  requireGardenAdmin(actor, 'Solo un administrador puede agregar participantes.');
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { kitchenGardenParticipant: { is: null } },
        { kitchenGardenParticipant: { is: { active: false } } },
      ],
    },
    select: { id: true, ...userPublicSelect, kitchenGardenParticipant: { select: { id: true } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return {
    candidates: users.map((user) => ({
      userId: user.id,
      displayName: resolveVisibleName(user),
      colorHex: user.employee?.colorHex ?? null,
      roleLabel: roleLabelOf(user),
      returning: user.kitchenGardenParticipant !== null,
    })),
  };
}

/** Bloquea la fila del participante dentro de la transacción (desactivar vs. asignar). */
export async function lockParticipant(
  tx: Prisma.TransactionClient,
  participantId: string,
): Promise<{ active: boolean } | null> {
  const rows = await tx.$queryRaw<{ active: boolean }[]>(
    Prisma.sql`SELECT "active" FROM "kitchen_garden_participants" WHERE "id" = ${participantId}::uuid FOR UPDATE`,
  );
  return rows[0] ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Agregar un participante (ADMIN): un usuario ACTIVE existente. Si ya
 * participó y fue desactivado, se reactiva la MISMA participación (su
 * historial sigue siendo suyo). Nunca crea usuarios ni empleados.
 */
export async function addGardenParticipant(actor: GardenActor, userId: string, meta: RequestMeta) {
  requireGardenAdmin(actor, 'Solo un administrador puede agregar participantes.');
  let participantId: string;
  try {
    participantId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true, kitchenGardenParticipant: { select: { id: true, active: true } } },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new ValidationError('Elegí un usuario activo de la app.');
      }
      const existing = user.kitchenGardenParticipant;
      if (existing?.active) throw new GardenParticipantAlreadyActiveError();
      if (existing) {
        const { count } = await tx.kitchenGardenParticipant.updateMany({
          where: { id: existing.id, active: false },
          data: { active: true },
        });
        if (count === 0) throw new GardenParticipantAlreadyActiveError();
        await recordAuditLog(tx, {
          actorUserId: actor.userId,
          action: 'kitchen_garden.participant_reactivated',
          entityType: 'KitchenGardenParticipant',
          entityId: existing.id,
          previousState: { active: false },
          newState: { active: true, userId },
          ...meta,
        });
        return existing.id;
      }
      const created = await tx.kitchenGardenParticipant.create({
        data: { userId },
        select: { id: true },
      });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'kitchen_garden.participant_added',
        entityType: 'KitchenGardenParticipant',
        entityId: created.id,
        newState: { userId, active: true },
        ...meta,
      });
      return created.id;
    });
  } catch (error) {
    // Dos altas simultáneas de la misma persona: gana una (`user_id` único).
    if (isUniqueViolation(error)) throw new GardenParticipantAlreadyActiveError();
    throw error;
  }
  return { participant: await participantDto(participantId) };
}

async function participantDto(participantId: string) {
  const row = await prisma.kitchenGardenParticipant.findUniqueOrThrow({
    where: { id: participantId },
    select: participantSelect,
  });
  const entry = entryOf(row);
  return {
    ...entry.person,
    active: entry.active,
    roleLabel: entry.roleLabel,
    userActive: entry.userActive,
  };
}

/**
 * Activar o desactivar una participación (ADMIN). Desactivar conserva
 * actividades e historial, pero se rechaza mientras tenga actividades
 * ACTIVAS asignadas (nada se reasigna ni se borra solo). La fila se bloquea:
 * una asignación simultánea espera y ve el estado final.
 */
export async function setGardenParticipantActive(
  actor: GardenActor,
  participantId: string,
  active: boolean,
  meta: RequestMeta,
) {
  requireGardenAdmin(actor, 'Solo un administrador puede administrar participantes.');
  await prisma.$transaction(async (tx) => {
    const current = await lockParticipant(tx, participantId);
    if (!current) throw new GardenParticipantNotFoundError();
    if (current.active === active) return;
    if (active) {
      const row = await tx.kitchenGardenParticipant.findUniqueOrThrow({
        where: { id: participantId },
        select: { user: { select: { status: true } } },
      });
      if (row.user.status !== 'ACTIVE') {
        throw new ValidationError(
          'La cuenta de esta persona no está activa: reactivala en Usuarios.',
        );
      }
    } else {
      const assigned = await tx.kitchenGardenActivity.count({
        where: { participantId, active: true },
      });
      if (assigned > 0) throw new GardenParticipantHasActivitiesError(assigned);
    }
    await tx.kitchenGardenParticipant.update({ where: { id: participantId }, data: { active } });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: active
        ? 'kitchen_garden.participant_reactivated'
        : 'kitchen_garden.participant_deactivated',
      entityType: 'KitchenGardenParticipant',
      entityId: participantId,
      previousState: { active: current.active },
      newState: { active },
      ...meta,
    });
  });
  return { participant: await participantDto(participantId) };
}
