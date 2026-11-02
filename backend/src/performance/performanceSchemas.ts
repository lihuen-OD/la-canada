import { z } from 'zod';
import { parseLocalDate } from '../lib/businessTime';
import { TASK_FREQUENCIES } from '../tasks/taskSchemas';
import { DETAIL_PAGE_MAX, DETAIL_STATUSES } from './performanceDetail';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
export const performanceRangeSchema = z.object({ from: date, to: date }).strict();
export const performanceEmployeeParamsSchema = z
  .object({ employeeId: z.string().uuid('Identificador inválido.') })
  .strict();

/**
 * Detalle de una persona: el rango de siempre y, opcionales, los filtros
 * (día dentro del rango, frecuencia, estado) y la página (`cursor` opaco y
 * `limit` 1–50). Sin ninguno de ellos, la respuesta de siempre.
 */
export const performanceDetailQuerySchema = performanceRangeSchema
  .extend({
    date: date
      .refine((value) => parseLocalDate(value) !== null, 'La fecha elegida no existe.')
      .optional(),
    frequency: z.enum(TASK_FREQUENCIES, { message: 'Frecuencia inválida.' }).optional(),
    status: z.enum(DETAIL_STATUSES, { message: 'Estado inválido.' }).optional(),
    cursor: z
      .string()
      .min(1)
      .max(2048, 'No pudimos continuar la lista. Actualizá el detalle.')
      .regex(/^[A-Za-z0-9_-]+$/, 'No pudimos continuar la lista. Actualizá el detalle.')
      .optional(),
    limit: z
      .string()
      .regex(/^\d{1,2}$/, `La página debe tener entre 1 y ${DETAIL_PAGE_MAX} registros.`)
      .transform(Number)
      .pipe(
        z
          .number()
          .min(1, `La página debe tener entre 1 y ${DETAIL_PAGE_MAX} registros.`)
          .max(DETAIL_PAGE_MAX, `La página debe tener entre 1 y ${DETAIL_PAGE_MAX} registros.`),
      )
      .optional(),
  })
  .strict();
