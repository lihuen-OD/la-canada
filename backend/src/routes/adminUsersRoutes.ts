import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import {
  activateUser,
  changeStatus,
  listUsers,
  resetPin,
} from '../controllers/adminUsersController';

export const adminUsersRouter = Router();

// Ningún endpoint acá permite que un empleado cambie su propio PIN — todo
// este router es exclusivo de ADMIN (ver la regla de negocio en
// docs/BUSINESS_RULES.md, "Roles y permisos").
adminUsersRouter.use(requireAuth, requireRole('ADMIN'));
adminUsersRouter.get('/users', listUsers);
adminUsersRouter.post('/users/:id/activate', requireJsonContentType, activateUser);
adminUsersRouter.post('/users/:id/reset-pin', requireJsonContentType, resetPin);
adminUsersRouter.patch('/users/:id/status', requireJsonContentType, changeStatus);
