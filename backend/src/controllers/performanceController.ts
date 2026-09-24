import type { Request, Response } from 'express';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';
import {
  performanceEmployeeParamsSchema,
  performanceRangeSchema,
} from '../performance/performanceSchemas';
import { getPerformance } from '../performance/performanceService';
import { resolveActor } from '../tasks/tasksService';

function parse<T>(
  result: { success: boolean; data?: T; error?: { issues: { message: string }[] } },
  fallback: string,
): T {
  if (!result.success) throw new ValidationError(result.error?.issues[0]?.message ?? fallback);
  return result.data as T;
}

async function actor(req: Request) {
  if (!req.auth) throw new AuthenticationRequiredError();
  return resolveActor(req.auth);
}

export async function getPerformanceSummary(req: Request, res: Response) {
  const query = parse(performanceRangeSchema.safeParse(req.query), 'Rango inválido.');
  res
    .set('Cache-Control', 'no-store')
    .status(200)
    .json(await getPerformance(await actor(req), query));
}

export async function getEmployeePerformance(req: Request, res: Response) {
  const query = parse(performanceRangeSchema.safeParse(req.query), 'Rango inválido.');
  const params = parse(performanceEmployeeParamsSchema.safeParse(req.params), 'Empleado inválido.');
  res
    .set('Cache-Control', 'no-store')
    .status(200)
    .json(await getPerformance(await actor(req), query, params.employeeId));
}
