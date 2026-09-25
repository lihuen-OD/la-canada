import { Router } from 'express';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { requireAuth } from '../middleware/requireAuth';
import {
  getStockCategories,
  getStockDestinations,
  getStockItem,
  getStockItemMovements,
  getStockItems,
  getStockReportCsvHandler,
  getStockReportMovementsHandler,
  getStockReportSummaryHandler,
  patchStockCategory,
  patchStockDestination,
  patchStockItem,
  patchStockItemStatus,
  postStockCategory,
  postStockDestination,
  postStockItem,
  postStockMovement,
} from '../controllers/stockController';

/**
 * Ningún endpoint de stock es público. Los permisos por rol (catálogo,
 * ajustes, ver inactivos) se deciden en `stock/stockService.ts` con el rol y
 * el empleado leídos de la base — no con un `requireRole` por ruta, porque
 * varias rutas sirven a ambos roles con reglas distintas (ingresos y
 * consumos son de cualquier usuario logueado; ajustes y catálogo, solo
 * ADMIN). El historial de movimientos es inmutable: solo existe POST de
 * creación, nunca PUT/PATCH/DELETE sobre movimientos. Los destinos tampoco
 * se borran (Etapa 5C.1): solo POST/PATCH — la baja es inactivación. Los
 * reportes (Etapa 5C.2) son solo lectura: agregaciones en Postgres.
 */
export const stockRouter = Router();

stockRouter.use(requireAuth);
stockRouter.get('/items', getStockItems);
stockRouter.get('/categories', getStockCategories);
stockRouter.get('/destinations', getStockDestinations);
stockRouter.get('/reports/summary', getStockReportSummaryHandler);
stockRouter.get('/reports/movements', getStockReportMovementsHandler);
stockRouter.get('/reports/movements.csv', getStockReportCsvHandler);
stockRouter.get('/items/:id', getStockItem);
stockRouter.get('/items/:id/movements', getStockItemMovements);
stockRouter.post('/categories', requireJsonContentType, postStockCategory);
stockRouter.patch('/categories/:id', requireJsonContentType, patchStockCategory);
stockRouter.post('/destinations', requireJsonContentType, postStockDestination);
stockRouter.patch('/destinations/:id', requireJsonContentType, patchStockDestination);
stockRouter.post('/items', requireJsonContentType, postStockItem);
stockRouter.patch('/items/:id', requireJsonContentType, patchStockItem);
stockRouter.patch('/items/:id/status', requireJsonContentType, patchStockItemStatus);
stockRouter.post('/items/:id/movements', requireJsonContentType, postStockMovement);
