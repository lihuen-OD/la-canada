import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import {
  getActivities,
  getHistory,
  getParticipantCandidates,
  getParticipantPerformance,
  getParticipants,
  getPerformanceSummary,
  patchActivity,
  patchActivityStatus,
  patchParticipantStatus,
  postActivity,
  postActivityCompletion,
  postActivityRevert,
  postParticipant,
} from '../controllers/kitchenGardenController';

/**
 * 🥬 Huerta (`/api/v1/kitchen-garden`): endpoints PROPIOS, nunca los de
 * Tareas. Nada es público; los permisos por rol y por participación se
 * deciden en `kitchenGarden/*` con datos leídos de la base (varias rutas
 * sirven a todos con reglas distintas, como en Tareas).
 */
export const kitchenGardenRouter = Router();

kitchenGardenRouter.use(requireAuth);
kitchenGardenRouter.get('/participants', getParticipants);
kitchenGardenRouter.get('/participants/candidates', getParticipantCandidates);
kitchenGardenRouter.post('/participants', requireJsonContentType, postParticipant);
kitchenGardenRouter.patch(
  '/participants/:id/status',
  requireJsonContentType,
  patchParticipantStatus,
);
kitchenGardenRouter.get('/activities', getActivities);
kitchenGardenRouter.post('/activities', requireJsonContentType, postActivity);
kitchenGardenRouter.patch('/activities/:id', requireJsonContentType, patchActivity);
kitchenGardenRouter.patch('/activities/:id/status', requireJsonContentType, patchActivityStatus);
kitchenGardenRouter.post(
  '/activities/:id/complete',
  requireJsonContentType,
  postActivityCompletion,
);
kitchenGardenRouter.post('/activities/:id/revert', requireJsonContentType, postActivityRevert);
kitchenGardenRouter.get('/history', getHistory);
kitchenGardenRouter.get('/performance/summary', getPerformanceSummary);
kitchenGardenRouter.get('/performance/participants/:id', getParticipantPerformance);
