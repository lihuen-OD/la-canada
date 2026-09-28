import { Router } from 'express';
import { getDashboardHandler } from '../controllers/dashboardController';
import { requireAuth } from '../middleware/requireAuth';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.get('/', getDashboardHandler);
