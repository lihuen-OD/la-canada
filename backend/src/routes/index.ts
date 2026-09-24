import { Router } from 'express';
import { healthRouter } from './healthRoutes';
import { authRouter } from './authRoutes';
import { adminUsersRouter } from './adminUsersRoutes';
import { tasksRouter } from './tasksRoutes';

export const apiV1Router = Router();
apiV1Router.use(healthRouter);
apiV1Router.use('/auth', authRouter);
apiV1Router.use('/admin', adminUsersRouter);
apiV1Router.use('/tasks', tasksRouter);
// El resto de los módulos de negocio (stock, gallinero, etc.) se montarán
// acá en etapas futuras — ver docs/MIGRATION_PLAN.md.
