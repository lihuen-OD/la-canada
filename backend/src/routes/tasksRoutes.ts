import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import {
  getTaskEmployees,
  getTaskHistory,
  getTasks,
  patchTask,
  patchTaskStatus,
  postTask,
  postTaskCompletion,
  postTaskRevert,
} from '../controllers/tasksController';

/**
 * Ningún endpoint de tareas es público. Los permisos por rol (crear,
 * editar, activar/desactivar, ver desactivadas, corregir ejecuciones
 * ajenas) se deciden en `tasks/tasksService.ts` con el rol y el empleado
 * leídos de la base — no con un `requireRole` por ruta, porque varias
 * rutas sirven a ambos roles con reglas distintas.
 */
export const tasksRouter = Router();

tasksRouter.use(requireAuth);
tasksRouter.get('/', getTasks);
tasksRouter.get('/employees', getTaskEmployees);
tasksRouter.get('/history', getTaskHistory);
tasksRouter.post('/', requireJsonContentType, postTask);
tasksRouter.patch('/:id', requireJsonContentType, patchTask);
tasksRouter.patch('/:id/status', requireJsonContentType, patchTaskStatus);
tasksRouter.post('/:id/complete', requireJsonContentType, postTaskCompletion);
tasksRouter.post('/:id/revert', requireJsonContentType, postTaskRevert);
