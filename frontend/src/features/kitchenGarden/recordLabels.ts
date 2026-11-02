import type { GardenActivityKind, GardenAgenda } from '../../api/kitchenGardenTypes';
import { DESCRIPTION_MAX } from '../tasks/taskFormFields';

/**
 * 🥬 Huerta → 📝 Registros: textos del tipo y de los grupos de la agenda.
 * Solo presentación: el grupo de cada registro lo decide el backend.
 */

export const KIND_ORDER: readonly GardenActivityKind[] = ['SOWING', 'TRANSPLANT', 'OTHER'];

export const KIND_LABEL: Record<GardenActivityKind, string> = {
  SOWING: 'Siembra',
  TRANSPLANT: 'Trasplante',
  OTHER: 'Otra actividad',
};

export const KIND_ICON: Record<GardenActivityKind, string> = {
  SOWING: '🌱',
  TRANSPLANT: '🪴',
  OTHER: '🧺',
};

/** Registros anteriores al tipo: se muestran así, sin error ni bloqueo. */
export const UNCLASSIFIED_LABEL = 'Sin clasificar';

export type KindFilter = 'all' | GardenActivityKind | 'UNCLASSIFIED';

export const AGENDA_SECTIONS: readonly { agenda: GardenAgenda; title: string; icon: string }[] = [
  { agenda: 'OVERDUE', title: 'Vencidas', icon: '⚠️' },
  { agenda: 'TODAY', title: 'Para hoy', icon: '📍' },
  { agenda: 'UPCOMING', title: 'Próximas', icon: '🗓️' },
  { agenda: 'NO_DATE', title: 'Sin fecha', icon: '🕓' },
];

/**
 * Descripción sugerida (editable) del trasplante que se programa junto con
 * una siembra: «Sembrar LECHUGA» → «Trasplantar LECHUGA». Solo un valor
 * inicial del formulario; nunca clasifica ni cambia registros existentes.
 */
export function transplantDescriptionFor(sowingDescription: string): string {
  const text = sowingDescription.replace(/\s+/g, ' ').trim();
  const rest = text.replace(/^sembrar\s+/i, '');
  return `Trasplantar ${rest}`.slice(0, DESCRIPTION_MAX).trim();
}
