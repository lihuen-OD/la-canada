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
