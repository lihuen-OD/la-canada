import type { TaskFrequency, TaskSuggestion, TaskSuggestionField } from '../../api/taskTypes';
import { EXECUTION_ORDER_MAX, SUGGESTION_INPUTS } from './taskLabels';

/**
 * Piezas del formulario de una tarea que también usa 🥬 Huerta (📝
 * Registros): normalización y validación de la descripción, orden de
 * realización y programación sugerida. Las mismas reglas que el backend, que
 * igual vuelve a validar todo.
 */

export const DESCRIPTION_MAX = 200;

/** Misma normalización que el backend (que igual vuelve a validar todo). */
export function normalizeDescription(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function validateDescription(value: string): string | null {
  if (value.length < 3) return 'La descripción debe tener al menos 3 caracteres.';
  if (value.length > DESCRIPTION_MAX)
    return `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;
  if (/[<>]/.test(value)) return 'La descripción no puede contener HTML.';
  return null;
}

export const SUGGESTION_FIELDS: readonly TaskSuggestionField[] = [
  'suggestedWeekday',
  'suggestedFirstHalfDay',
  'suggestedSecondHalfDay',
  'suggestedMonthDay',
  'suggestedMonth',
];

/** Valores de los `<select>` de la sugerencia; vacío = sin dato. */
export type SuggestionForm = Record<TaskSuggestionField, string>;

export const suggestionFormOf = (task?: TaskSuggestion): SuggestionForm =>
  Object.fromEntries(
    SUGGESTION_FIELDS.map((field) => [field, task?.[field] != null ? String(task[field]) : '']),
  ) as SuggestionForm;

/** Al cambiar de frecuencia se conserva solo lo que la nueva admite (el backend hace lo mismo). */
export function keepValidSuggestion(
  values: SuggestionForm,
  frequency: TaskFrequency | '',
): SuggestionForm {
  const kept = suggestionFormOf();
  for (const input of frequency ? SUGGESTION_INPUTS[frequency] : []) {
    if (input.options.some((option) => String(option.value) === values[input.field])) {
      kept[input.field] = values[input.field];
    }
  }
  return kept;
}

export const ORDER_ERROR = `El orden de realización debe ser un número entero de 1 a ${EXECUTION_ORDER_MAX}.`;

/** «Orden de realización» del campo: `null` = vacío; `undefined` = inválido. */
export function parseExecutionOrder(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const order = Number(trimmed);
  return /^\d+$/.test(trimmed) && order >= 1 && order <= EXECUTION_ORDER_MAX ? order : undefined;
}
