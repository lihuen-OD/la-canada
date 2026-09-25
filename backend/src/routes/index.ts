import { Router } from 'express';
import { healthRouter } from './healthRoutes';
import { authRouter } from './authRoutes';
import { adminUsersRouter } from './adminUsersRoutes';
import { tasksRouter } from './tasksRoutes';
import { performanceRouter } from './performanceRoutes';
import { stockRouter } from './stockRoutes';
import { chickenCoopRouter } from './chickenCoopRoutes';

export const apiV1Router = Router();
apiV1Router.use(healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/admin', adminUsersRouter);
apiV1Router.use('/tasks', tasksRouter);
apiV1Router.use('/performance', performanceRouter);
apiV1Router.use('/stock', stockRouter);
apiV1Router.use('/chicken-coop', chickenCoopRouter);
// El resto de los módulos de negocio (mascotas, etc.) se montarán
// acá en etapas futuras — ver docs/MIGRATION_PLAN.md.
