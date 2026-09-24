import { Router } from 'express';
import {
  getEmployeePerformance,
  getPerformanceSummary,
} from '../controllers/performanceController';
import { requireAuth } from '../middleware/requireAuth';

export const performanceRouter = Router();
performanceRouter.use(requireAuth);
performanceRouter.get('/summary', getPerformanceSummary);
performanceRouter.get('/employees/:employeeId', getEmployeePerformance);
