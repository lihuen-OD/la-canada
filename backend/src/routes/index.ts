import { Router } from 'express';
import { healthRouter } from './healthRoutes';

export const apiV1Router = Router();
apiV1Router.use(healthRouter);
// Los módulos de negocio (tareas, stock, gallinero, etc.) se montarán acá
// en etapas futuras — ver docs/MIGRATION_PLAN.md, Etapa 7.
