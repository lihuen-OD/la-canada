import type { PerformanceMetrics } from './performanceTypes';
import type { TaskFrequency, TaskScheduleStatus, TaskSuggestion } from './taskTypes';

/**
 * Contratos de `/api/v1/kitchen-garden` (🥬 Huerta) — leídos de
 * `backend/src/kitchenGarden/*`. Módulo propio: mismas frecuencias, estados y
 * reglas que ✅ Tareas, pero sus personas son PARTICIPANTES de la Huerta
 * (usuarios existentes, empleados o administradores), nunca empleados de
 * Tareas. El frontend no calcula períodos, estados ni métricas.
 */

export interface GardenPerson {
  /** Id del PARTICIPANTE (estable), nunca el nombre. */
  id: string;
  displayName: string;
  colorHex: string | null;
}

export interface GardenParticipant extends GardenPerson {
  active: boolean;
  /** Puesto del empleado o «Administrador». */
  roleLabel: string;
  /** La cuenta sigue activa (una suspendida conserva su historia). */
  userActive: boolean;
}

export interface GardenCandidate {
  userId: string;
  displayName: string;
  colorHex: string | null;
  roleLabel: string;
  /** Ya participó y fue desactivada: agregarla reactiva su participación. */
  returning: boolean;
}

export interface GardenExecution {
  id: string;
  periodKey: string;
  completedAt: string;
  /** Responsable esperado en ese período (snapshot). */
  assignedTo: GardenPerson;
  /** Quién la realizó realmente. */
  completedBy: GardenPerson;
  canRevert: boolean;
}

export interface GardenActivity extends TaskSuggestion {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  responsible: GardenPerson & { active: boolean };
  periodKey: string;
  scheduledDate: string | null;
  scheduleStatus: TaskScheduleStatus | null;
  executionOrder: number | null;
  suggestedDate: string | null;
  currentExecution: GardenExecution | null;
  canComplete: boolean;
}

export type GardenStatusFilter = 'active' | 'inactive' | 'all';

export interface GardenActivitiesResponse {
  period: { today: string; weekStart: string; timeZone: string; generatedAt?: string };
  activities: GardenActivity[];
}

export interface CreateGardenActivityRequest extends Partial<TaskSuggestion> {
  description: string;
  participantId: string;
  frequency: TaskFrequency;
  scheduledDate?: string | null;
  executionOrder?: number | null;
}

export type UpdateGardenActivityRequest = Partial<CreateGardenActivityRequest>;

export interface GardenHistoryActivity {
  id: string;
  description: string;
  frequency: TaskFrequency;
  active: boolean;
  responsible: GardenPerson;
  scheduledDate: string | null;
}

export interface GardenHistoryResponse {
  week: { start: string; end: string; days: string[]; isCurrent: boolean; timeZone: string };
  summary: { expected: number; completed: number };
  recurring: {
    activity: GardenHistoryActivity;
    slots: { periodKey: string; expected: boolean; execution: GardenExecution | null }[];
  }[];
  others: { activity: GardenHistoryActivity; execution: GardenExecution }[];
}

export interface GardenPerformanceOccurrence {
  activityId: string;
  description: string;
  frequency: TaskFrequency;
  status: 'personal' | 'covered' | 'pending';
  periodKey: string;
  assignedParticipantId: string;
  completedByParticipantId: string | null;
  assignedTo: GardenPerson | null;
  completedBy: GardenPerson | null;
  completedAt: string | null;
  scheduledDate?: string;
}

export interface GardenPerformanceResponse {
  generatedAt?: string;
  range: {
    from: string;
    to: string;
    today?: string;
    timeZone: string;
    includesCurrentDay: boolean;
    maxDays: number;
  };
  /** `team`: ADMIN; `self`: lo propio; `none`: no participa (sin filas). */
  scope: 'team' | 'self' | 'none';
  team: PerformanceMetrics;
  special: { urgentCompleted: number; oneTimeCompleted: number; urgentPending: number | null };
  participants: ({
    participant: GardenPerson & { roleLabel: string; active: boolean };
  } & PerformanceMetrics)[];
  occurrences?: GardenPerformanceOccurrence[];
}

// ── 🥕 Cultivos y 📝 Registros (2026-11-02) ───────────────────────────────

export type GardenSowingMethod = 'DIRECT' | 'SEEDBED';
export type GardenCropRecordType = 'SOWING' | 'TRANSPLANT';
/** Semillas o gramos en la siembra; plantines en el trasplante (nunca se mezclan). */
export type GardenQuantityUnit = 'SEEDS' | 'GRAMS' | 'SEEDLINGS';
/** «Previsto para…», «Para hoy» o «Fecha prevista pasada» (lo calcula el backend). */
export type GardenTransplantDueStatus = 'SCHEDULED' | 'DUE_TODAY' | 'PAST';

/** Lo que puede hacer quien mira (el backend igual decide). */
export interface GardenCropViewer {
  canRecord: boolean;
  /** Su participación activa: se preselecciona como «quién lo hizo». */
  participantId: string | null;
}

export interface GardenCrop {
  id: string;
  name: string;
  batchCount: number;
}

export interface GardenTransplantPlan {
  pending: boolean;
  expectedDate: string | null;
  status: GardenTransplantDueStatus | null;
  /** Alguien confirmó «No quedan trasplantes pendientes». */
  closedAt: string | null;
  closedBy?: { displayName: string } | null;
}

export interface GardenCropRecord {
  id: string;
  type: GardenCropRecordType;
  performedOn: string;
  /** Quien REALIZÓ el hecho (participante). */
  performedBy: GardenPerson;
  /** El usuario que lo registró. */
  recordedBy: { displayName: string };
  method: GardenSowingMethod | null;
  location: string;
  quantity: string | null;
  quantityUnit: GardenQuantityUnit | null;
  notes: string | null;
  version: number;
  createdAt: string;
}

interface GardenBatchCore {
  id: string;
  crop: { id: string; name: string };
  name: string;
  variety: string | null;
  notes: string | null;
  archived: boolean;
  archivedAt: string | null;
  version: number;
  transplantPlan: GardenTransplantPlan;
}

export interface GardenBatchSummary extends GardenBatchCore {
  sowing: {
    id: string;
    performedOn: string;
    method: GardenSowingMethod;
    location: string;
    performedBy: GardenPerson;
  } | null;
  transplantCount: number;
}

export interface GardenBatchDetail extends GardenBatchCore {
  /** `null`: su siembra se anuló. */
  sowing: GardenCropRecord | null;
  transplants: GardenCropRecord[];
}

export type GardenBatchStatusFilter = 'active' | 'archived' | 'all';

export interface GardenBatchesResponse {
  batches: GardenBatchSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  today: string;
  generatedAt?: string;
  refreshAt?: string;
  viewer: GardenCropViewer;
}

export interface GardenBatchResponse {
  batch: GardenBatchDetail;
  today: string;
  generatedAt?: string;
  viewer: GardenCropViewer;
}

export interface GardenBatchMutationResponse {
  batch: GardenBatchDetail;
  changed?: boolean;
}

export interface CreateGardenSowingRequest {
  cropName: string;
  batchName: string;
  variety?: string;
  batchNotes?: string;
  performedOn: string;
  performedByParticipantId: string;
  method: GardenSowingMethod;
  location: string;
  quantity?: string;
  quantityUnit?: 'SEEDS' | 'GRAMS';
  notes?: string;
  expectedTransplantDate?: string;
}

export interface CreateGardenTransplantRequest {
  batchVersion: number;
  performedOn: string;
  performedByParticipantId: string;
  location: string;
  quantity?: string;
  notes?: string;
  /** Decisión explícita: `false` con pendientes = «No quedan trasplantes pendientes». */
  remainingPending: boolean;
  /** Omitida: se conserva la prevista; `null`: sin fecha. */
  expectedTransplantDate?: string | null;
}

export interface UpdateGardenBatchRequest {
  version: number;
  cropName?: string;
  name?: string;
  variety?: string | null;
  notes?: string | null;
  transplantPending?: boolean;
  expectedTransplantDate?: string | null;
}

export interface UpdateGardenCropRecordRequest {
  version: number;
  performedOn?: string;
  performedByParticipantId?: string;
  location?: string;
  method?: GardenSowingMethod;
  quantity?: string | null;
  quantityUnit?: 'SEEDS' | 'GRAMS' | null;
  notes?: string | null;
}

export interface GardenCropRecordFilters {
  from?: string;
  to?: string;
  cropId?: string;
  batchId?: string;
  type?: GardenCropRecordType;
  participantId?: string;
}

export interface GardenCropRecordListItem extends GardenCropRecord {
  batch: { id: string; name: string; crop: { id: string; name: string }; archived: boolean };
}

export interface GardenCropRecordsResponse {
  records: GardenCropRecordListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  today: string;
  viewer: GardenCropViewer;
}
