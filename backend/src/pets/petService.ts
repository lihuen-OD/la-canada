import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import { recordAuditLog } from '../auth/auditLog';
import {
  EmployeeLinkRequiredError,
  ForbiddenError,
  PetMedicalRecordAlreadyVoidedError,
  PetMedicalRecordNotFoundError,
  PetNotFoundError,
  PetTypeBuiltinError,
  PetTypeDuplicateError,
  PetTypeNotFoundError,
  ValidationError,
} from '../errors/AppError';
import {
  compareLocalDates,
  formatLocalDate,
  parseLocalDate,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { canonicalRequestHash, executeIdempotent } from '../lib/idempotency';
import { getObjectStorage } from '../lib/objectStorage';
import { prisma } from '../lib/prisma';
import { resolveActor, type RequestMeta, type TaskActor } from '../tasks/tasksService';
import {
  BUILTIN_PET_TYPE_NAMES,
  DEFAULT_PET_ICON,
  PET_TYPE_ICON_OPTIONS,
  type MedicalRecordTypeName,
} from './petCatalog';
import { computePetAge, daysToNextBirthday } from './petDates';
import type {
  createPetBodySchema,
  createPetRecordBodySchema,
  createPetTypeBodySchema,
  updatePetBodySchema,
} from './petSchemas';

/**
 * 🐾 Mascotas (Etapa 5M) — docs/BUSINESS_RULES.md §11–§12. Permisos
 * (paridad con el prototipo), decididos acá con el rol leído de la base:
 *  - ver listado, ficha, KPIs e historial, y registrar datos clínicos:
 *    todo usuario autenticado;
 *  - alta/edición de mascota, foto, alta/baja de tipos y eliminar
 *    (anular) registros clínicos: solo ADMIN.
 *
 * La persona asociada a un registro sale de la sesión (su empleado, o
 * ninguna para un ADMIN sin empleado — como `currentUser` en el prototipo)
 * y el actor real queda en `recordedByUserId` + `AuditLog`. Nada se borra
 * físicamente: los registros se anulan y los tipos se desactivan.
 */

export type PetActor = TaskActor;
export type { RequestMeta };
export { resolveActor };

type CreatePetTypeInput = z.infer<typeof createPetTypeBodySchema>;
type CreatePetInput = z.infer<typeof createPetBodySchema>;
type UpdatePetInput = z.infer<typeof updatePetBodySchema>;
type CreatePetRecordInput = z.infer<typeof createPetRecordBodySchema>;

const CREATE_RECORD_ENDPOINT = (petId: string) => `POST /pets/${petId.toLowerCase()}/records`;
const BUILTIN = new Set(BUILTIN_PET_TYPE_NAMES.map((name) => name.toLocaleLowerCase('es-AR')));

function requireAdmin(actor: PetActor, message?: string): void {
  if (actor.role !== 'ADMIN') throw new ForbiddenError(message);
}

const isBuiltinType = (name: string) => BUILTIN.has(name.toLocaleLowerCase('es-AR'));
const dateText = (value: Date): string => value.toISOString().slice(0, 10);
const toDbDate = (date: LocalDate): Date => new Date(Date.UTC(date.year, date.month - 1, date.day));
const businessToday = (now: Date) => toLocalDate(now, config.businessTimeZone);

/** Hoy o una fecha pasada de `BUSINESS_TIME_ZONE`, nunca futura. */
function resolvePastDate(text: string, now: Date, label: string): LocalDate {
  const local = parseLocalDate(text);
  if (!local) throw new ValidationError(`${label} no es válida.`);
  if (compareLocalDates(local, businessToday(now)) > 0) {
    throw new ValidationError(`${label} no puede ser futura.`);
  }
  return local;
}

const photoStorageStatus = () => (getObjectStorage() ? 'configured' : 'unconfigured');

// ── Selecciones y serialización ───────────────────────────────────────────

const typeSelect = { id: true, name: true, icon: true, active: true } as const;
type TypeRow = Prisma.AnimalTypeGetPayload<{ select: typeof typeSelect }>;

function serializeType(row: TypeRow) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon ?? DEFAULT_PET_ICON,
    active: row.active,
    builtin: isBuiltinType(row.name),
  };
}

/** La foto vigente es la última `AVAILABLE` de la categoría de ficha. */
const currentPhotoSelect = {
  where: { status: 'AVAILABLE', category: 'ANIMAL_PROFILE' },
  orderBy: { createdAt: 'desc' },
  take: 1,
  select: { id: true },
} as const;

const lastWeightSelect = {
  where: { type: 'WEIGHT', voidedAt: null },
  orderBy: [
    { recordDate: 'desc' },
    { createdAt: 'desc' },
  ] as Prisma.AnimalMedicalRecordOrderByWithRelationInput[],
  take: 1,
  select: { value: true, recordDate: true },
} as const;

const petSelect = {
  id: true,
  name: true,
  breed: true,
  birthDate: true,
  active: true,
  createdAt: true,
  animalType: { select: typeSelect },
  photos: currentPhotoSelect,
  medicalRecords: lastWeightSelect,
} as const;
type PetRow = Prisma.AnimalGetPayload<{ select: typeof petSelect }>;

function serializePet(row: PetRow, today: LocalDate) {
  const birth = row.birthDate ? parseLocalDate(dateText(row.birthDate)) : null;
  const weight = row.medicalRecords[0];
  return {
    id: row.id,
    name: row.name,
    breed: row.breed,
    birthDate: row.birthDate ? dateText(row.birthDate) : null,
    active: row.active,
    type: serializeType(row.animalType),
    age: birth ? computePetAge(birth, today) : null,
    daysToBirthday: birth ? daysToNextBirthday(birth, today) : null,
    lastWeight:
      weight?.value != null
        ? { kg: weight.value.toString(), date: dateText(weight.recordDate) }
        : null,
    photo: row.photos[0] ? { id: row.photos[0].id } : null,
  };
}

export type SerializedPet = ReturnType<typeof serializePet>;

const recordSelect = {
  id: true,
  type: true,
  recordDate: true,
  description: true,
  value: true,
  createdAt: true,
  employee: { select: { id: true, displayName: true, colorHex: true } },
} as const;
type RecordRow = Prisma.AnimalMedicalRecordGetPayload<{ select: typeof recordSelect }>;

function serializeRecord(row: RecordRow) {
  return {
    id: row.id,
    type: row.type,
    recordDate: dateText(row.recordDate),
    description: row.description,
    weightKg: row.value?.toString() ?? null,
    employee: row.employee,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SerializedPetRecord = ReturnType<typeof serializeRecord>;

// ── Tipos ─────────────────────────────────────────────────────────────────

/**
 * Catálogo de tipos + cantidad de mascotas activas de cada uno (los chips del
 * listado solo muestran tipos con mascotas, como el prototipo) + las
 * opciones del selector de símbolo. Dos sentencias fijas.
 */
export async function listPetTypes(actor: PetActor, filters: { status: 'active' | 'all' }) {
  if (filters.status !== 'active') requireAdmin(actor, 'Solo un administrador ve tipos inactivos.');
  const [types, counts] = await Promise.all([
    prisma.animalType.findMany({
      where: filters.status === 'active' ? { active: true } : {},
      select: typeSelect,
      orderBy: { createdAt: 'asc' },
    }),
    prisma.animal.groupBy({
      by: ['animalTypeId'],
      where: { active: true },
      _count: { _all: true },
    }),
  ]);
  const byType = new Map(counts.map((row) => [row.animalTypeId, row._count._all]));
  return {
    types: types.map((row) => ({
      ...serializeType(row),
      activeAnimalCount: byType.get(row.id) ?? 0,
    })),
    iconOptions: PET_TYPE_ICON_OPTIONS,
  };
}

/**
 * "+ Agregar tipo" (ADMIN). El nombre ya llega con mayúscula inicial; la
 * duplicidad se compara sin distinguir mayúsculas. Si el tipo existía y
 * estaba dado de baja, se reactiva con el símbolo elegido (nunca se crea
 * un segundo tipo con el mismo nombre). El símbolo se persiste: el
 * prototipo lo perdía al recargar.
 */
export async function createPetType(actor: PetActor, input: CreatePetTypeInput, meta: RequestMeta) {
  requireAdmin(actor, 'Solo un administrador puede agregar tipos.');
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.animalType.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' } },
        select: typeSelect,
      });
      if (existing?.active) throw new PetTypeDuplicateError();
      const row = existing
        ? await tx.animalType.update({
            where: { id: existing.id },
            data: { active: true, icon: input.icon },
            select: typeSelect,
          })
        : await tx.animalType.create({
            data: { name: input.name, icon: input.icon },
            select: typeSelect,
          });
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: existing ? 'pet.type.reactivated' : 'pet.type.created',
        entityType: 'AnimalType',
        entityId: row.id,
        previousState: existing ? { active: false, icon: existing.icon } : null,
        newState: { name: row.name, icon: row.icon, active: true },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { type: { ...serializeType(row), activeAnimalCount: 0 } };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new PetTypeDuplicateError();
    }
    throw error;
  }
}

/**
 * "×" de un tipo (ADMIN): baja lógica. "Las mascotas de este tipo no se
 * borran" (prototipo): conservan su tipo; solo deja de ofrecerse para
 * mascotas nuevas. Los 9 precargados no se pueden dar de baja.
 */
export async function deactivatePetType(actor: PetActor, typeId: string, meta: RequestMeta) {
  requireAdmin(actor, 'Solo un administrador puede eliminar tipos.');
  return prisma.$transaction(async (tx) => {
    const row = await tx.animalType.findUnique({ where: { id: typeId }, select: typeSelect });
    if (!row) throw new PetTypeNotFoundError();
    if (isBuiltinType(row.name)) throw new PetTypeBuiltinError();
    const { count } = await tx.animalType.updateMany({
      where: { id: typeId, active: true },
      data: { active: false },
    });
    if (count > 0) {
      await recordAuditLog(tx, {
        actorUserId: actor.userId,
        action: 'pet.type.deactivated',
        entityType: 'AnimalType',
        entityId: typeId,
        previousState: { active: true },
        newState: { active: false },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }
    return { type: { ...serializeType({ ...row, active: false }) } };
  });
}

// ── Mascotas ──────────────────────────────────────────────────────────────

/**
 * Listado de mascotas activas (como el prototipo), en orden de alta,
 * filtrable por tipo y paginado. Sentencias fijas: conteo + página (Prisma
 * resuelve tipo, foto vigente y último peso con una sentencia por relación
 * para TODA la página, nunca una por mascota).
 */
export async function listPets(
  _actor: PetActor,
  filters: { typeId?: string; page: number; pageSize: number },
  now = new Date(),
) {
  const where: Prisma.AnimalWhereInput = {
    active: true,
    ...(filters.typeId ? { animalTypeId: filters.typeId } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.animal.count({ where }),
    prisma.animal.findMany({
      where,
      select: petSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  const today = businessToday(now);
  return {
    pets: rows.map((row) => serializePet(row, today)),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    photoStorage: photoStorageStatus(),
  };
}

/** Ficha + KPIs del prototipo (vacunas, último peso, desparasitaciones, próximo cumple). */
export async function getPet(_actor: PetActor, petId: string, now = new Date()) {
  const [row, counts] = await Promise.all([
    prisma.animal.findUnique({ where: { id: petId }, select: petSelect }),
    prisma.animalMedicalRecord.groupBy({
      by: ['type'],
      where: { animalId: petId, voidedAt: null },
      _count: { _all: true },
    }),
  ]);
  if (!row) throw new PetNotFoundError();
  const countOf = (type: MedicalRecordTypeName) =>
    counts.find((entry) => entry.type === type)?._count._all ?? 0;
  const pet = serializePet(row, businessToday(now));
  return {
    pet,
    kpis: {
      vaccines: countOf('VACCINE'),
      dewormings: countOf('DEWORMING'),
      lastWeight: pet.lastWeight,
      daysToBirthday: pet.daysToBirthday,
    },
    today: formatLocalDate(businessToday(now)),
    photoStorage: photoStorageStatus(),
  };
}

async function requireActiveType(tx: Prisma.TransactionClient, typeId: string) {
  const type = await tx.animalType.findUnique({ where: { id: typeId }, select: { active: true } });
  if (!type?.active) throw new PetTypeNotFoundError();
}

function auditPetState(row: {
  name: string;
  animalTypeId: string;
  breed: string | null;
  birthDate: Date | null;
}) {
  return {
    name: row.name,
    animalTypeId: row.animalTypeId,
    breed: row.breed,
    birthDate: row.birthDate ? dateText(row.birthDate) : null,
  };
}

/** "+ Mascota" (ADMIN). Sin fecha de nacimiento futura. */
export async function createPet(
  actor: PetActor,
  input: CreatePetInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede agregar mascotas.');
  const birth = input.birthDate
    ? resolvePastDate(input.birthDate, now, 'La fecha de nacimiento')
    : null;
  const id = await prisma.$transaction(async (tx) => {
    await requireActiveType(tx, input.animalTypeId);
    const row = await tx.animal.create({
      data: {
        name: input.name,
        animalTypeId: input.animalTypeId,
        breed: input.breed ?? null,
        birthDate: birth ? toDbDate(birth) : null,
      },
      select: { id: true, name: true, animalTypeId: true, breed: true, birthDate: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'pet.created',
      entityType: 'Animal',
      entityId: row.id,
      newState: auditPetState(row),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return row.id;
  });
  return getPet(actor, id, now);
}

/** "✏️" de la ficha (ADMIN). Conservar un tipo hoy inactivo está permitido; cambiar a uno inactivo, no. */
export async function updatePet(
  actor: PetActor,
  petId: string,
  input: UpdatePetInput,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede editar mascotas.');
  const birth =
    input.birthDate === undefined
      ? undefined
      : input.birthDate === null
        ? null
        : resolvePastDate(input.birthDate, now, 'La fecha de nacimiento');
  await prisma.$transaction(async (tx) => {
    const before = await tx.animal.findUnique({
      where: { id: petId },
      select: { name: true, animalTypeId: true, breed: true, birthDate: true },
    });
    if (!before) throw new PetNotFoundError();
    if (input.animalTypeId && input.animalTypeId !== before.animalTypeId) {
      await requireActiveType(tx, input.animalTypeId);
    }
    const after = await tx.animal.update({
      where: { id: petId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.animalTypeId !== undefined ? { animalTypeId: input.animalTypeId } : {}),
        ...(input.breed !== undefined ? { breed: input.breed } : {}),
        ...(birth !== undefined ? { birthDate: birth ? toDbDate(birth) : null } : {}),
      },
      select: { name: true, animalTypeId: true, breed: true, birthDate: true },
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'pet.updated',
      entityType: 'Animal',
      entityId: petId,
      previousState: auditPetState(before),
      newState: auditPetState(after),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });
  return getPet(actor, petId, now);
}

// ── Registros clínicos ────────────────────────────────────────────────────

export async function listPetRecords(
  _actor: PetActor,
  petId: string,
  filters: { type?: MedicalRecordTypeName; page: number; pageSize: number },
) {
  const where: Prisma.AnimalMedicalRecordWhereInput = {
    animalId: petId,
    voidedAt: null,
    ...(filters.type ? { type: filters.type } : {}),
  };
  const [pet, total, rows] = await Promise.all([
    prisma.animal.findUnique({ where: { id: petId }, select: { id: true } }),
    prisma.animalMedicalRecord.count({ where }),
    prisma.animalMedicalRecord.findMany({
      where,
      select: recordSelect,
      orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  if (!pet) throw new PetNotFoundError();
  return {
    records: rows.map(serializeRecord),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

export type CreatePetRecordResult =
  | { kind: 'created'; body: { record: SerializedPetRecord } }
  | { kind: 'replay'; status: number; body: Prisma.JsonValue };

/**
 * "Guardar registro" (todo usuario autenticado). Persona = la de la sesión
 * (un EMPLOYEE necesita su empleado activo; un ADMIN sin empleado queda sin
 * persona, como el prototipo). Acepta `Idempotency-Key`.
 */
export async function createPetRecord(
  actor: PetActor,
  petId: string,
  input: CreatePetRecordInput,
  meta: RequestMeta,
  now = new Date(),
  idempotencyKey?: string,
): Promise<CreatePetRecordResult> {
  if (actor.role !== 'ADMIN' && !actor.employeeId) throw new EmployeeLinkRequiredError();
  const date = resolvePastDate(input.recordDate, now, 'La fecha');
  const recordDate = formatLocalDate(date);
  const weight =
    input.type === 'WEIGHT' && input.weightKg ? new Prisma.Decimal(input.weightKg) : null;

  const write = async (tx: Prisma.TransactionClient) => {
    const pet = await tx.animal.findUnique({ where: { id: petId }, select: { active: true } });
    if (!pet?.active) throw new PetNotFoundError();
    const row = await tx.animalMedicalRecord.create({
      data: {
        animalId: petId,
        type: input.type,
        recordDate: toDbDate(date),
        description: input.description ?? null,
        value: weight,
        employeeId: actor.employeeId,
        recordedByUserId: actor.userId,
      },
      select: recordSelect,
    });
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'pet.record_created',
      entityType: 'AnimalMedicalRecord',
      entityId: row.id,
      newState: {
        animalId: petId,
        type: row.type,
        recordDate,
        weightKg: weight?.toString() ?? null,
        employeeId: actor.employeeId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { record: serializeRecord(row) };
  };

  if (idempotencyKey === undefined) {
    return { kind: 'created', body: await prisma.$transaction(write) };
  }
  const endpoint = CREATE_RECORD_ENDPOINT(petId);
  return executeIdempotent({
    actorUserId: actor.userId,
    endpoint,
    key: idempotencyKey,
    requestHash: canonicalRequestHash([
      endpoint,
      input.type,
      recordDate,
      weight?.toFixed(2) ?? null,
      input.description ?? null,
    ]),
    status: 201,
    run: write,
  });
}

/** "✕" del historial (solo ADMIN, confirmación en el cliente): anulación lógica auditada. */
export async function voidPetRecord(
  actor: PetActor,
  petId: string,
  recordId: string,
  meta: RequestMeta,
  now = new Date(),
) {
  requireAdmin(actor, 'Solo un administrador puede eliminar registros.');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.animalMedicalRecord.findUnique({
      where: { id: recordId },
      select: { animalId: true, type: true, recordDate: true, value: true },
    });
    if (!existing || existing.animalId !== petId) throw new PetMedicalRecordNotFoundError();
    const { count } = await tx.animalMedicalRecord.updateMany({
      where: { id: recordId, voidedAt: null },
      data: { voidedAt: now, voidedByUserId: actor.userId },
    });
    if (count === 0) throw new PetMedicalRecordAlreadyVoidedError();
    await recordAuditLog(tx, {
      actorUserId: actor.userId,
      action: 'pet.record_voided',
      entityType: 'AnimalMedicalRecord',
      entityId: recordId,
      previousState: {
        animalId: petId,
        type: existing.type,
        recordDate: dateText(existing.recordDate),
        weightKg: existing.value?.toString() ?? null,
        voided: false,
      },
      newState: { voided: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { record: { id: recordId, voidedAt: now.toISOString() } };
  });
}
