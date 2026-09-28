import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import {
  activateUser,
  changeDisplayName,
  changeStatus,
  createAdmin,
  listUsers,
  resetPin,
} from '../controllers/adminUsersController';

export const adminUsersRouter = Router();

// Ningún endpoint acá permite que un empleado cambie su propio PIN — todo
// este router es exclusivo de ADMIN (ver la regla de negocio en
// docs/BUSINESS_RULES.md, "Roles y permisos").
adminUsersRouter.use(requireAuth, requireRole('ADMIN'));
adminUsersRouter.get('/users', listUsers);
/** Etapa 5U — alta de otro ADMIN (sin Employee), ya activo con su PIN. */
adminUsersRouter.post('/users/admins', requireJsonContentType, createAdmin);
adminUsersRouter.post('/users/:id/activate', requireJsonContentType, activateUser);
adminUsersRouter.post('/users/:id/reset-pin', requireJsonContentType, resetPin);
adminUsersRouter.patch('/users/:id/status', requireJsonContentType, changeStatus);
/** Etapa 5U — nombre visible de una cuenta sin Employee (otro ADMIN). */
adminUsersRouter.patch('/users/:id/display-name', requireJsonContentType, changeDisplayName);
