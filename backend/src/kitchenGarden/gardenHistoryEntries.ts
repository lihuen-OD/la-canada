import type { Prisma } from '../generated/prisma/client';
import type { KitchenGardenActivityKind } from '../generated/prisma/enums';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import {
  addDays,
  compareLocalDates,
  computePeriodKey,
  formatLocalDate,
  parseLocalDate,
  startOfLocalDay,
  toLocalDate,
  type LocalDate,
} from '../lib/businessTime';
import { ValidationError } from '../errors/AppError';
import { canRevertExecution, personFrom } from './gardenActivitiesService';
import { loadParticipantDirectory, loadUserPeople, type GardenActor } from './gardenParticipants';

/**
 * 🥬 Huerta → 📅 Historial cronológico (docs/BUSINESS_RULES.md, "🥬 Huerta:
 * registros"): las ejecuciones, más recientes primero, sin tener que saber la
 * semana. Por defecto los últimos 30 días de negocio; también un rango
 * («Desde»/«Hasta», cada uno opcional) o todo el historial. Filtros en la
 * base: texto en la descripción, tipo, persona que la realizó y, a pedido,
 * las deshechas (marcadas). Páginas de 20 con cursor `(completed_at, id)`:
 * orden estable y sin duplicados aunque se agreguen ejecuciones entre una
 * página y otra.
 *
 * La única fecha que guarda una ejecución de la Huerta es `completed_at`
 * (cuándo se registró como completada): se informa como tal, nunca como una
 * fecha de realización declarada. Descripción y tipo son los ACTUALES de la
 * actividad (no se versionan): editar una actividad cambia cómo se ven sus
 * ejecuciones anteriores.
 */

export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_RECENT_DAYS = 30;

export type HistoryKindFilter = KitchenGardenActivityKind | 'UNCLASSIFIED';

export interface GardenHistoryEntriesParams {
  from?: string;
  to?: string;
  all?: boolean;
  q?: string;
  kind?: HistoryKindFilter;
  participantId?: string;
  includeReverted?: boolean;
  cursor?: string;
}

const CURSOR_SEPARATOR = '|';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cursor opaco: la última fila de la página (`completed_at` exacto e id). */
export function encodeHistoryCursor(completedAt: Date, id: string): string {
  return Buffer.from(`${completedAt.toISOString()}${CURSOR_SEPARATOR}${id}`).toString('base64url');
}

export function decodeHistoryCursor(cursor: string): { completedAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split(CURSOR_SEPARATOR);
  const completedAt = new Date(iso ?? '');
  if (!id || !UUID.test(id) || Number.isNaN(completedAt.getTime())) {
    throw new ValidationError('La página pedida no es válida: volvé a cargar el historial.');
  }
  return { completedAt, id };
}

/** `contains` de Prisma no escapa `%` ni `_`: se buscan como texto literal. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

function localDateOrThrow(value: string, label: string): LocalDate {
  const parsed = parseLocalDate(value);
  if (!parsed) throw new ValidationError(`La fecha «${label}» no es válida.`);
  return parsed;
}

/** Rango pedido: todo, el indicado (cada extremo opcional) o, sin datos, los últimos 30 días. */
function resolveRange(params: GardenHistoryEntriesParams, today: LocalDate) {
  if (params.all) {
    if (params.from || params.to) {
      throw new ValidationError('Elegí un rango de fechas o todo el historial, no las dos cosas.');
    }
    return { mode: 'all' as const, from: null, to: null };
  }
  if (params.from || params.to) {
    const from = params.from ? localDateOrThrow(params.from, 'Desde') : null;
    const to = params.to ? localDateOrThrow(params.to, 'Hasta') : null;
    if (from && to && compareLocalDates(from, to) > 0) {
      throw new ValidationError('«Desde» no puede ser posterior a «Hasta».');
    }
    return { mode: 'custom' as const, from, to };
  }
  return {
    mode: 'recent' as const,
    from: addDays(today, -(HISTORY_RECENT_DAYS - 1)),
    to: today,
  };
}

const entrySelect = {
  id: true,
  periodKey: true,
  completedAt: true,
  assignedParticipantId: true,
  completedByParticipantId: true,
  recordedByUserId: true,
  revertedAt: true,
  revertedByUserId: true,
  revertReason: true,
  activity: {
    select: { id: true, description: true, kind: true, frequency: true, active: true },
  },
} as const;

/** `GET /kitchen-garden/history/entries`: consulta para todo usuario autenticado. */
export async function listGardenHistoryEntries(
  actor: GardenActor,
  params: GardenHistoryEntriesParams,
  now = new Date(),
) {
  const timeZone = config.businessTimeZone;
  const today = toLocalDate(now, timeZone);
  const range = resolveRange(params, today);
  const cursor = params.cursor ? decodeHistoryCursor(params.cursor) : null;

  const completedAt: Prisma.DateTimeFilter = {};
  if (range.from) completedAt.gte = startOfLocalDay(range.from, timeZone);
  if (range.to) completedAt.lt = startOfLocalDay(addDays(range.to, 1), timeZone);
  const activity: Prisma.KitchenGardenActivityWhereInput = {};
  if (params.q) {
    activity.description = { contains: escapeLike(params.q), mode: 'insensitive' };
  }
  if (params.kind) activity.kind = params.kind === 'UNCLASSIFIED' ? null : params.kind;
  const and: Prisma.KitchenGardenExecutionWhereInput[] = [];
  if (range.from || range.to) and.push({ completedAt });
  if (cursor) {
    and.push({
      OR: [
        { completedAt: { lt: cursor.completedAt } },
        { completedAt: cursor.completedAt, id: { lt: cursor.id } },
      ],
    });
  }

  const [rows, directory] = await Promise.all([
    prisma.kitchenGardenExecution.findMany({
      where: {
        ...(params.includeReverted ? {} : { revertedAt: null }),
        ...(params.participantId ? { completedByParticipantId: params.participantId } : {}),
        ...(Object.keys(activity).length > 0 ? { activity } : {}),
        ...(and.length > 0 ? { AND: and } : {}),
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_PAGE_SIZE + 1,
      select: entrySelect,
    }),
    loadParticipantDirectory(),
  ]);
  const page = rows.slice(0, HISTORY_PAGE_SIZE);
  const users = await loadUserPeople(
    page.flatMap((row) => [
      row.recordedByUserId,
      ...(row.revertedByUserId ? [row.revertedByUserId] : []),
    ]),
  );

  const entries = page.map((row) => {
    const recorder = users.get(row.recordedByUserId);
    return {
      id: row.id,
      periodKey: row.periodKey,
      /** Cuándo se registró como completada (la única fecha que guarda la Huerta). */
      completedAt: row.completedAt.toISOString(),
      /** Día de negocio de `completedAt`, para agrupar. */
      completedOn: formatLocalDate(toLocalDate(row.completedAt, timeZone)),
      /** Descripción y tipo ACTUALES de la actividad (no se versionan). */
      activity: row.activity,
      completedBy: personFrom(directory, row.completedByParticipantId),
      assignedTo: personFrom(directory, row.assignedParticipantId),
      // Solo si la registró otra persona (p. ej. un ADMIN a nombre de un participante).
      recordedBy:
        recorder && recorder.participantId !== row.completedByParticipantId
          ? { id: row.recordedByUserId, displayName: recorder.displayName }
          : null,
      reverted: row.revertedAt
        ? {
            revertedAt: row.revertedAt.toISOString(),
            revertedBy: row.revertedByUserId
              ? (users.get(row.revertedByUserId)?.displayName ?? null)
              : null,
            reason: row.revertReason,
          }
        : null,
      // Las mismas reglas de siempre (`revertGardenCompletion` vuelve a validar).
      canRevert:
        row.revertedAt === null &&
        canRevertExecution(actor, row, computePeriodKey(row.activity.frequency, now, timeZone)),
    };
  });
  const last = page.at(-1);
  return {
    range: {
      mode: range.mode,
      from: range.from ? formatLocalDate(range.from) : null,
      to: range.to ? formatLocalDate(range.to) : null,
      today: formatLocalDate(today),
      timeZone,
    },
    entries,
    nextCursor:
      rows.length > HISTORY_PAGE_SIZE && last
        ? encodeHistoryCursor(last.completedAt, last.id)
        : null,
    generatedAt: now.toISOString(),
  };
}

export type GardenHistoryEntry = Awaited<
  ReturnType<typeof listGardenHistoryEntries>
>['entries'][number];
