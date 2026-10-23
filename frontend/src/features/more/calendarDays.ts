import type { TaskItem } from '../../api/taskTypes';

/**
 * Marca del prototipo (`rndCal`/`calDia`): diarias todos los días, semanales
 * de lunes a viernes y mensuales el día 1; quincenales, con el mismo criterio
 * que las mensuales, el primer día de cada quincena (1 y 16); bimestrales, el
 * 1 de cada bimestre (ene, mar, may, jul, sep, nov) y anuales, el 1 de enero.
 * Una «Una vez» con fecha para realizar se marca ese día. Es un indicador
 * visual aproximado (docs/BUSINESS_RULES.md §5), no la regla de cumplimiento —
 * esa vive en el backend de Tareas. `month` va de 0 a 11.
 */
export function tasksForDay(tasks: readonly TaskItem[], year: number, month: number, day: number) {
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  const date = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return tasks.filter(
    (task) =>
      task.frequency === 'DAILY' ||
      (task.frequency === 'WEEKLY' && weekday >= 1 && weekday <= 5) ||
      (task.frequency === 'SEMI_MONTHLY' && (day === 1 || day === 16)) ||
      (task.frequency === 'MONTHLY' && day === 1) ||
      (task.frequency === 'BIMONTHLY' && day === 1 && month % 2 === 0) ||
      (task.frequency === 'ANNUAL' && day === 1 && month === 0) ||
      (task.frequency === 'ONE_TIME' && task.scheduledDate === date),
  );
}
