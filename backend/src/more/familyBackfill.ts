import { recordAuditLog } from '../auth/auditLog';
import { prisma } from '../lib/prisma';
import { birthdayPersonKey } from './birthdays';
import { loadBirthdayInputs } from './eventsService';

/**
 * Backfill operativo (Etapa 5F) — NO es parte de la migración versionada:
 * asocia los cumpleaños familiares reales del seed (Vicky, Felicitas) al único
 * ADMIN activo como "Mi familia", sobre las MISMAS filas (mismo id, slug,
 * nombre, día y mes: nada se copia ni se borra). Parentesco: `FAMILY`, porque
 * el prototipo solo decía `nota: 'familia'` (no hay evidencia de pareja/hijo).
 *
 * Reglas:
 *  - exactamente UN ADMIN activo (se detiene con 0 o con más de uno); nunca se
 *    lo identifica por `username`; un ADMIN con ficha de equipo también detiene
 *    (su familia viviría en `EmployeeChild`, no acá);
 *  - claves naturales = los `slug` del seed (`FAMILY_SEED_SLUGS`, igual a
 *    `recurringBirthdaySeeds` — verificado por test); una
 *    fila faltante o asociada a OTRO usuario detiene todo sin escribir;
 *  - idempotente: una segunda corrida no cambia nada (`unchanged`);
 *  - al terminar verifica que cada familiar activo aparece UNA sola vez entre
 *    los cumpleaños de Eventos (derivados + manuales equivalentes).
 * Pensado para `production` después de crear su ADMIN; en esta etapa el script
 * solo corre contra `demo` (`DATABASE_TARGET=demo`, ver `scripts/`).
 */

export class FamilyBackfillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FamilyBackfillError';
  }
}

/**
 * Claves naturales de los familiares reales de `prisma/seed-data/recurringBirthdays.ts`
 * (el build no importa el seed; un test verifica que coincidan). Benjamín no
 * está: fecha contradictoria.
 */
export const FAMILY_SEED_SLUGS: readonly string[] = ['vicky', 'felicitas'];

export interface FamilyBackfillReport {
  associated: string[];
  unchanged: string[];
  /** Apariciones de cada familiar en los cumpleaños de Eventos (debe ser 1 si está activo). */
  occurrences: Record<string, number>;
}

export async function backfillAdminFamily(): Promise<FamilyBackfillReport> {
  const result = await prisma.$transaction(async (tx) => {
    const admins = await tx.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true, employeeId: true },
      take: 2,
    });
    if (admins.length !== 1) {
      throw new FamilyBackfillError(
        admins.length === 0
          ? 'No hay ningún ADMIN activo: creá el administrador antes de asociar la familia.'
          : 'Hay más de un ADMIN activo: no se puede decidir a quién asociar la familia.',
      );
    }
    const admin = admins[0] as { id: string; employeeId: string | null };
    if (admin.employeeId) {
      throw new FamilyBackfillError(
        'El ADMIN activo tiene ficha de equipo: su familia se carga como hijos del empleado.',
      );
    }
    const rows = await tx.recurringBirthday.findMany({
      where: { slug: { in: [...FAMILY_SEED_SLUGS] } },
      select: { id: true, slug: true, ownerUserId: true },
    });
    for (const slug of FAMILY_SEED_SLUGS) {
      const row = rows.find((candidate) => candidate.slug === slug);
      if (!row) throw new FamilyBackfillError(`Falta el cumpleaños familiar "${slug}" del seed.`);
      if (row.ownerUserId && row.ownerUserId !== admin.id) {
        throw new FamilyBackfillError(`"${slug}" ya pertenece a otro usuario: no se reasigna.`);
      }
    }
    const associated: string[] = [];
    const unchanged: string[] = [];
    for (const row of rows) {
      const slug = row.slug as string;
      if (row.ownerUserId === admin.id) {
        unchanged.push(slug);
        continue;
      }
      const { count } = await tx.recurringBirthday.updateMany({
        where: { id: row.id, ownerUserId: null },
        data: { ownerUserId: admin.id, relation: 'FAMILY' },
      });
      if (count !== 1) throw new FamilyBackfillError(`"${slug}" cambió durante el backfill.`);
      await recordAuditLog(tx, {
        actorUserId: null,
        action: 'family.member_associated',
        entityType: 'RecurringBirthday',
        entityId: row.id,
        previousState: { ownerUserId: null, relation: null },
        newState: { ownerUserId: admin.id, relation: 'FAMILY', slug },
      });
      associated.push(slug);
    }
    return { associated: associated.sort(), unchanged: unchanged.sort(), ids: rows };
  });

  // Verificación posterior: una sola aparición por familiar entre derivados y manuales vigentes.
  const [inputs, rows] = await Promise.all([
    loadBirthdayInputs(),
    prisma.recurringBirthday.findMany({
      where: { slug: { in: [...FAMILY_SEED_SLUGS] } },
      select: { id: true, slug: true, personLabel: true, active: true },
    }),
  ]);
  const manual = await prisma.event.findMany({
    where: { type: 'BIRTHDAY', deletedAt: null },
    select: { title: true },
  });
  const occurrences: Record<string, number> = {};
  for (const row of rows) {
    const person = birthdayPersonKey(row.personLabel);
    const derived = inputs.filter(
      (input) => input.name !== null && birthdayPersonKey(input.name) === person,
    ).length;
    const manualCount = manual.filter((event) => birthdayPersonKey(event.title) === person).length;
    const total = derived + manualCount;
    occurrences[row.slug as string] = total;
    if (row.active && total !== 1) {
      throw new FamilyBackfillError(
        `"${row.slug}" aparece ${total} veces en Eventos (se esperaba 1): revisalo antes de continuar.`,
      );
    }
  }
  return { associated: result.associated, unchanged: result.unchanged, occurrences };
}
