import type {
  ChickenCoopState,
  ChickenCoopSummary,
  EggCollection,
  EggCollectionDay,
  EggCollectionHistoryResponse,
} from '../../api/chickenCoopTypes';

/**
 * Fixtures SINTÉTICOS, solo para tests (nunca importados por código de
 * runtime). Cantidades y personas explícitamente de prueba: no representan
 * gallinas ni recolecciones reales.
 */
export const COLLECTOR_A = {
  id: '00000000-0000-4000-8000-00000000e0a1',
  displayName: 'Persona sintética A',
  colorHex: null,
};
export const COLLECTOR_B = {
  id: '00000000-0000-4000-8000-00000000e0b2',
  displayName: 'Persona sintética B',
  colorHex: null,
};

export const CONFIGURED_COOP: ChickenCoopState = {
  configured: true,
  activeHensCount: 10,
  updatedAt: '2026-09-20T12:00:00.000Z',
};
export const PENDING_COOP: ChickenCoopState = {
  configured: false,
  activeHensCount: null,
  updatedAt: null,
};

export function makeSummary(
  overrides: { coop?: ChickenCoopState; days?: 7 | 30 | 90 | 365; empty?: boolean } = {},
): ChickenCoopSummary {
  const coop = overrides.coop ?? CONFIGURED_COOP;
  const days = overrides.days ?? 7;
  const configured = coop.activeHensCount !== null;
  const daily = Array.from({ length: Math.min(days, 14) }, (_, index) => {
    const day = 25 - (Math.min(days, 14) - 1 - index);
    const date = day > 0 ? `2026-09-${String(day).padStart(2, '0')}` : `2026-08-${31 + day}`;
    return {
      date,
      goodEggs: overrides.empty ? 0 : date === '2026-09-25' ? 7 : date === '2026-09-24' ? 5 : 0,
    };
  });
  return {
    timeZone: 'America/Argentina/Buenos_Aires',
    coop,
    today: {
      date: '2026-09-25',
      goodEggs: overrides.empty ? 0 : 7,
      brokenEggs: overrides.empty ? 0 : 1,
      layingRate: configured && !overrides.empty ? 70 : configured ? 0 : null,
    },
    period: {
      days,
      from: daily[0]?.date ?? '2026-09-19',
      to: '2026-09-25',
      goodEggs: overrides.empty ? 0 : 12,
      brokenEggs: overrides.empty ? 0 : 1,
      daysWithData: overrides.empty ? 0 : 2,
      averagePerDay: overrides.empty ? '0' : '6.0',
      layingRate: configured && !overrides.empty ? 60 : null,
      daily,
    },
  };
}

export function makeCollection(overrides: Partial<EggCollection> = {}): EggCollection {
  return {
    id: '00000000-0000-4000-8000-0000000c0001',
    collectionDate: '2026-09-25',
    goodEggsCount: 7,
    brokenEggsCount: 1,
    notes: 'Observación sintética',
    employee: COLLECTOR_A,
    createdAt: '2026-09-25T13:00:00.000Z',
    ...overrides,
  };
}

export function makeDay(overrides: Partial<EggCollectionDay> = {}): EggCollectionDay {
  return {
    date: '2026-09-25',
    goodEggs: 7,
    brokenEggs: 1,
    layingRate: 70,
    collections: [makeCollection()],
    ...overrides,
  };
}

export function historyResponse(
  days: EggCollectionDay[] = [makeDay()],
  page = 1,
  totalPages = 1,
): EggCollectionHistoryResponse {
  return {
    coop: CONFIGURED_COOP,
    days,
    page,
    pageSize: 10,
    totalDays: days.length,
    totalPages,
  };
}
