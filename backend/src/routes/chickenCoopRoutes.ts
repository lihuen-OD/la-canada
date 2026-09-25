import { Router } from 'express';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { requireAuth } from '../middleware/requireAuth';
import {
  getChickenCoopSummaryHandler,
  getEggCollectionHistoryHandler,
  postChickenCoopConfiguration,
  postChickenCoopHensAdjustment,
  postEggCollection,
  postVoidEggCollection,
} from '../controllers/chickenCoopController';

/**
 * 🐔 Gallinero (Etapa 5G). Ningún endpoint es público. Los permisos por rol
 * (configurar, altas/bajas, eliminar recolecciones: solo ADMIN) se deciden
 * en `chickenCoop/chickenCoopService.ts` con el rol leído de la base.
 * No existe `DELETE` ni edición de recolecciones: "eliminar" es una
 * anulación lógica auditada (`POST /collections/:id/void`).
 */
export const chickenCoopRouter = Router();

chickenCoopRouter.use(requireAuth);
chickenCoopRouter.get('/summary', getChickenCoopSummaryHandler);
chickenCoopRouter.get('/collections', getEggCollectionHistoryHandler);
chickenCoopRouter.post('/collections', requireJsonContentType, postEggCollection);
chickenCoopRouter.post('/collections/:id/void', requireJsonContentType, postVoidEggCollection);
chickenCoopRouter.post('/configuration', requireJsonContentType, postChickenCoopConfiguration);
chickenCoopRouter.post('/hens-adjustments', requireJsonContentType, postChickenCoopHensAdjustment);
