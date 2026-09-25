import type { TaskItem } from '../../api/taskTypes';

/**
 * Marca del prototipo (`rndCal`/`calDia`): diarias todos los días, semanales
 * de lunes a viernes y mensuales el día 1. Es un indicador visual aproximado
 * (docs/BUSINESS_RULES.md §5), no la regla de cumplimiento — esa vive en el
 * backend de Tareas.
 */
export function tasksForDay(tasks: readonly TaskItem[], year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return tasks.filter(
    (task) =>
      task.frequency === 'DAILY' ||
      (task.frequency === 'WEEKLY' && weekday >= 1 && weekday <= 5) ||
      (task.frequency === 'MONTHLY' && day === 1),
  );
}
