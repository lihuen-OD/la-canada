/** Contrato de `/api/v1/chicken-coop` (Etapa 5G) — ver backend/src/chickenCoop. */

export type ChickenCoopPeriodDays = 7 | 30 | 90 | 365;

export interface ChickenCoopState {
  /** `false`: el ADMIN todavía no cargó la cantidad real de gallinas. */
  configured: boolean;
  activeHensCount: number | null;
  updatedAt: string | null;
}

export interface ChickenCoopSummary {
  timeZone: string;
  coop: ChickenCoopState;
  today: {
    /** Fecha de negocio de hoy (`BUSINESS_TIME_ZONE`), `YYYY-MM-DD`. */
    date: string;
    goodEggs: number;
    brokenEggs: number;
    /** `null` sin gallinas configuradas (o con 0). */
    layingRate: number | null;
  };
  period: {
    days: ChickenCoopPeriodDays;
    from: string;
    to: string;
    goodEggs: number;
    brokenEggs: number;
    daysWithData: number;
    /** Un decimal, calculado por el backend. */
    averagePerDay: string;
    layingRate: number | null;
    /** Últimos min(días, 14) días, en orden cronológico. */
    daily: { date: string; goodEggs: number }[];
  };
}

export interface EggCollector {
  id: string;
  displayName: string;
  colorHex: string | null;
}

export interface EggCollection {
  id: string;
  collectionDate: string;
  goodEggsCount: number;
  brokenEggsCount: number;
  notes: string | null;
  employee: EggCollector | null;
  createdAt: string;
}

export interface EggCollectionDay {
  date: string;
  goodEggs: number;
  brokenEggs: number;
  layingRate: number | null;
  collections: EggCollection[];
}

export interface EggCollectionHistoryResponse {
  coop: ChickenCoopState;
  days: EggCollectionDay[];
  page: number;
  pageSize: number;
  totalDays: number;
  totalPages: number;
}

export interface CreateEggCollectionRequest {
  goodEggsCount: number;
  brokenEggsCount: number;
  collectionDate?: string;
  /** Solo ADMIN; un EMPLOYEE nunca lo envía (el backend usa su sesión). */
  employeeId?: string;
  notes?: string;
}

export interface EggCollectionMutationResponse {
  collection: EggCollection;
}

export interface ChickenCoopMutationResponse {
  coop: ChickenCoopState;
}
