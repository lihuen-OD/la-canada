import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD.');
export const performanceRangeSchema = z.object({ from: date, to: date }).strict();
export const performanceEmployeeParamsSchema = z
  .object({ employeeId: z.string().uuid('Identificador inválido.') })
  .strict();
