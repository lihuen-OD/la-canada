import { Router } from 'express';
import { healthRouter } from './healthRoutes';
import { authRouter } from './authRoutes';
import { adminUsersRouter } from './adminUsersRoutes';
import { tasksRouter } from './tasksRoutes';
import { performanceRouter } from './performanceRoutes';
import { stockRouter } from './stockRoutes';
import { chickenCoopRouter } from './chickenCoopRoutes';
import { petsRouter } from './petsRoutes';
import {
  employeesRouter,
  eventsRouter,
  meRouter,
  moreRouter,
  newsRouter,
  photosRouter,
  weatherRouter,
} from './moreRoutes';

export const apiV1Router = Router();
apiV1Router.use(healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/admin', adminUsersRouter);
apiV1Router.use('/tasks', tasksRouter);
apiV1Router.use('/performance', performanceRouter);
apiV1Router.use('/stock', stockRouter);
apiV1Router.use('/chicken-coop', chickenCoopRouter);
apiV1Router.use('/pets', petsRouter);
// ☰ Más (Etapa 5X): Novedades, Eventos, Clima, Fotos, Configuración y Mi perfil.
apiV1Router.use('/more', moreRouter);
apiV1Router.use('/news', newsRouter);
apiV1Router.use('/events', eventsRouter);
apiV1Router.use('/weather', weatherRouter);
apiV1Router.use('/photos', photosRouter);
apiV1Router.use('/employees', employeesRouter);
apiV1Router.use('/me', meRouter);
