import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { requireRole } from '../middleware/requireRole';
import {
  deleteMyFamilyHandler,
  getEmployeesHandler,
  getMyFamilyHandler,
  getEventsHandler,
  getGardenVersionContentHandler,
  getGardenVersionsHandler,
  getMoreSummaryHandler,
  getMyProfileHandler,
  getNewsHandler,
  getNewsRepliesHandler,
  getPhotoContentHandler,
  getPhotoFoldersHandler,
  getPhotosHandler,
  getTeamProfilesHandler,
  getWeatherHandler,
  parseGardenPlanBody,
  parseGalleryPhotoBody,
  patchEmployeeHandler,
  patchEmployeeStatusHandler,
  patchEventHandler,
  patchMyFamilyHandler,
  patchMyFamilyStatusHandler,
  patchNewsHandler,
  patchNewsReplyHandler,
  patchPhotoFolderHandler,
  postDeleteEventHandler,
  postDeleteNewsHandler,
  postDeleteNewsReplyHandler,
  postDeletePhotoFolderHandler,
  postDeletePhotoHandler,
  postEmployeeHandler,
  postEventHandler,
  postGardenVersionHandler,
  postMyChildHandler,
  postMovePhotoHandler,
  postMyFamilyHandler,
  postNewsHandler,
  postNewsReplyHandler,
  postPhotoFolderHandler,
  postPhotoHandler,
  postRemoveMyChildHandler,
  putMyProfileHandler,
} from '../controllers/moreController';

/**
 * ☰ Más (Etapa 5X). Ningún endpoint es público. Sin `DELETE`: los eventos se
 * anulan, las fotos se dan de baja lógica antes del borrado físico y las
 * personas se desactivan; solo un hijo del propio perfil se elimina de verdad.
 * Los mensajes de Novedades se eliminan lógicamente (`POST …/delete`); los
 * permisos por autor/rol se deciden en el servicio, nunca con `requireRole`.
 */

export const moreRouter = Router();
moreRouter.use(requireAuth);
moreRouter.get('/summary', getMoreSummaryHandler);

export const newsRouter = Router();
newsRouter.use(requireAuth);
newsRouter.get('/', getNewsHandler);
newsRouter.post('/', requireJsonContentType, postNewsHandler);
newsRouter.patch('/:id', requireJsonContentType, patchNewsHandler);
newsRouter.post('/:id/delete', requireJsonContentType, postDeleteNewsHandler);
newsRouter.get('/:id/replies', getNewsRepliesHandler);
newsRouter.post('/:id/replies', requireJsonContentType, postNewsReplyHandler);
newsRouter.patch('/:id/replies/:replyId', requireJsonContentType, patchNewsReplyHandler);
newsRouter.post('/:id/replies/:replyId/delete', requireJsonContentType, postDeleteNewsReplyHandler);

export const eventsRouter = Router();
eventsRouter.use(requireAuth);
eventsRouter.get('/', getEventsHandler);
eventsRouter.post('/', requireJsonContentType, postEventHandler);
eventsRouter.patch('/:id', requireJsonContentType, patchEventHandler);
eventsRouter.post('/:id/delete', requireJsonContentType, postDeleteEventHandler);

export const weatherRouter = Router();
weatherRouter.use(requireAuth);
weatherRouter.get('/', getWeatherHandler);

/**
 * 📸 Fotos y sus carpetas: ver, subir, crear carpetas y mover fotos es de
 * todos; renombrar o eliminar una carpeta, de su creador o un ADMIN, y
 * eliminar una foto, solo ADMIN — lo decide cada servicio, nunca `requireRole`.
 */
export const photosRouter = Router();
photosRouter.use(requireAuth);
photosRouter.get('/', getPhotosHandler);
photosRouter.post('/', parseGalleryPhotoBody, postPhotoHandler);
photosRouter.get('/folders', getPhotoFoldersHandler);
photosRouter.post('/folders', requireJsonContentType, postPhotoFolderHandler);
photosRouter.patch('/folders/:id', requireJsonContentType, patchPhotoFolderHandler);
photosRouter.post('/folders/:id/delete', requireJsonContentType, postDeletePhotoFolderHandler);
photosRouter.get('/:id/content', getPhotoContentHandler);
photosRouter.post('/:id/delete', requireJsonContentType, postDeletePhotoHandler);
photosRouter.post('/:id/move', requireJsonContentType, postMovePhotoHandler);

/**
 * 🌳 Jardín: ver el plano y el historial es de todos (paridad con Fotos);
 * publicar una versión nueva es solo ADMIN (el router lo bloquea y el
 * servicio vuelve a exigirlo). Sin `DELETE` ni `PATCH`: las versiones son
 * inmutables y el historial no se recorta. El rol se comprueba ANTES del
 * parser binario, así un EMPLOYEE recibe el 403 sin subir 10 MB.
 */
export const gardenRouter = Router();
gardenRouter.use(requireAuth);
gardenRouter.get('/versions', getGardenVersionsHandler);
gardenRouter.post('/versions', requireRole('ADMIN'), parseGardenPlanBody, postGardenVersionHandler);
gardenRouter.get('/versions/:id/content', getGardenVersionContentHandler);

/** ⚙️ Configuración: exclusivo de ADMIN (y el servicio vuelve a exigirlo). */
export const employeesRouter = Router();
employeesRouter.use(requireAuth, requireRole('ADMIN'));
employeesRouter.get('/', getEmployeesHandler);
employeesRouter.get('/profiles', getTeamProfilesHandler);
employeesRouter.post('/', requireJsonContentType, postEmployeeHandler);
employeesRouter.patch('/:id', requireJsonContentType, patchEmployeeHandler);
employeesRouter.patch('/:id/status', requireJsonContentType, patchEmployeeStatusHandler);

/**
 * 👤 Mi perfil: siempre la persona de la sesión (nunca un `userId` del
 * cliente). Hijos: ficha de equipo. Familia: usuario sin Employee (Etapa 5F);
 * `DELETE` solo para un familiar cargado por error.
 */
export const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get('/profile', getMyProfileHandler);
meRouter.put('/profile', requireJsonContentType, putMyProfileHandler);
meRouter.post('/children', requireJsonContentType, postMyChildHandler);
meRouter.post('/children/:id/remove', requireJsonContentType, postRemoveMyChildHandler);
meRouter.get('/family', getMyFamilyHandler);
meRouter.post('/family', requireJsonContentType, postMyFamilyHandler);
meRouter.patch('/family/:id', requireJsonContentType, patchMyFamilyHandler);
meRouter.patch('/family/:id/status', requireJsonContentType, patchMyFamilyStatusHandler);
meRouter.delete('/family/:id', deleteMyFamilyHandler);
