import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import {
  activateUser,
  changeStatus,
  listUsers,
  resetPassword,
} from '../controllers/adminUsersController';

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuth, requireRole('ADMIN'));
adminUsersRouter.get('/users', listUsers);
adminUsersRouter.post('/users/:id/activate', requireJsonContentType, activateUser);
adminUsersRouter.post('/users/:id/reset-password', requireJsonContentType, resetPassword);
adminUsersRouter.patch('/users/:id/status', requireJsonContentType, changeStatus);
