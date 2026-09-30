import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { getParticipants } from '../controllers/participantsController';

export const participantsRouter = Router();

participantsRouter.use(requireAuth);
participantsRouter.get('/', getParticipants);
