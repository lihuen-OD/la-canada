import { Router } from 'express';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { requireAuth } from '../middleware/requireAuth';
import {
  getPetHandler,
  getPetPhotoHandler,
  getPetRecordsHandler,
  getPetTypesHandler,
  getPetsHandler,
  parsePetPhotoBody,
  patchPet,
  patchPetTypeStatus,
  patchPetStatus,
  deletePetHandler,
  deletePetTypeHandler,
  postPet,
  postPetPhoto,
  postPetRecord,
  postPetType,
  postRemovePetPhoto,
  postVoidPetRecord,
} from '../controllers/petsController';

/**
 * 🐾 Mascotas (Etapa 5M). Ningún endpoint es público. Permisos por rol en
 * `pets/petService.ts`/`petPhotoService.ts` (rol leído de la base). Los
 * registros clínicos se anulan; `DELETE` solo existe para una mascota o un
 * tipo agregado creados por error y sin historia (ADMIN, 409 si la tienen).
 */
export const petsRouter = Router();

petsRouter.use(requireAuth);
petsRouter.get('/types', getPetTypesHandler);
petsRouter.post('/types', requireJsonContentType, postPetType);
petsRouter.patch('/types/:id/status', requireJsonContentType, patchPetTypeStatus);
petsRouter.delete('/types/:id', deletePetTypeHandler);
petsRouter.get('/photos/:fileId', getPetPhotoHandler);
petsRouter.get('/', getPetsHandler);
petsRouter.post('/', requireJsonContentType, postPet);
petsRouter.get('/:id', getPetHandler);
petsRouter.patch('/:id', requireJsonContentType, patchPet);
petsRouter.patch('/:id/status', requireJsonContentType, patchPetStatus);
petsRouter.delete('/:id', deletePetHandler);
petsRouter.get('/:id/records', getPetRecordsHandler);
petsRouter.post('/:id/records', requireJsonContentType, postPetRecord);
petsRouter.post('/:id/records/:recordId/void', requireJsonContentType, postVoidPetRecord);
petsRouter.post('/:id/photo', parsePetPhotoBody, postPetPhoto);
petsRouter.post('/:id/photo/remove', requireJsonContentType, postRemovePetPhoto);
