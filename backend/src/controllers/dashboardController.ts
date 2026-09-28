import type { Request, Response } from 'express';
import { AuthenticationRequiredError } from '../errors/AppError';
import { getDashboard } from '../dashboard/dashboardService';
import { resolveActor } from '../tasks/tasksService';

export async function getDashboardHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  const actor = await resolveActor(req.auth);
  res
    .set('Cache-Control', 'no-store')
    .status(200)
    .json(await getDashboard(actor));
}
