import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { requireRole } from '../middleware/requireRole';
import {
  getEmployeesHandler,
  getEventsHandler,
  getMoreSummaryHandler,
  getMyProfileHandler,
  getNewsHandler,
  getPhotoContentHandler,
  getPhotosHandler,
  getTeamProfilesHandler,
  getWeatherHandler,
  parseGalleryPhotoBody,
  patchEmployeeHandler,
  patchEmployeeStatusHandler,
  patchEventHandler,
  postDeleteEventHandler,
  postDeletePhotoHandler,
  postEmployeeHandler,
  postEventHandler,
  postMyChildHandler,
  postNewsHandler,
  postPhotoHandler,
  postRemoveMyChildHandler,
  putMyProfileHandler,
} from '../controllers/moreController';

/**
 * ☰ Más (Etapa 5X). Ningún endpoint es público. Sin `DELETE`: los eventos se
 * anulan, las fotos se dan de baja lógica antes del borrado físico y las
 * personas se desactivan; solo un hijo del propio perfil se elimina de verdad.
 */

export const moreRouter = Router();
moreRouter.use(requireAuth);
moreRouter.get('/summary', getMoreSummaryHandler);

export const newsRouter = Router();
newsRouter.use(requireAuth);
newsRouter.get('/', getNewsHandler);
newsRouter.post('/', requireJsonContentType, postNewsHandler);

export const eventsRouter = Router();
eventsRouter.use(requireAuth);
eventsRouter.get('/', getEventsHandler);
eventsRouter.post('/', requireJsonContentType, postEventHandler);
eventsRouter.patch('/:id', requireJsonContentType, patchEventHandler);
eventsRouter.post('/:id/delete', requireJsonContentType, postDeleteEventHandler);

export const weatherRouter = Router();
weatherRouter.use(requireAuth);
weatherRouter.get('/', getWeatherHandler);

export const photosRouter = Router();
photosRouter.use(requireAuth);
photosRouter.get('/', getPhotosHandler);
photosRouter.post('/', parseGalleryPhotoBody, postPhotoHandler);
photosRouter.get('/:id/content', getPhotoContentHandler);
photosRouter.post('/:id/delete', requireJsonContentType, postDeletePhotoHandler);

/** ⚙️ Configuración: exclusivo de ADMIN (y el servicio vuelve a exigirlo). */
export const employeesRouter = Router();
employeesRouter.use(requireAuth, requireRole('ADMIN'));
employeesRouter.get('/', getEmployeesHandler);
employeesRouter.get('/profiles', getTeamProfilesHandler);
employeesRouter.post('/', requireJsonContentType, postEmployeeHandler);
employeesRouter.patch('/:id', requireJsonContentType, patchEmployeeHandler);
employeesRouter.patch('/:id/status', requireJsonContentType, patchEmployeeStatusHandler);

/** 👤 Mi perfil: siempre el empleado de la sesión. */
export const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get('/profile', getMyProfileHandler);
meRouter.put('/profile', requireJsonContentType, putMyProfileHandler);
meRouter.post('/children', requireJsonContentType, postMyChildHandler);
meRouter.post('/children/:id/remove', requireJsonContentType, postRemoveMyChildHandler);
