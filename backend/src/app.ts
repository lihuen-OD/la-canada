import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { config } from './config';
import { corsOptions } from './config/cors';
import { createApiRateLimiter, createImageRateLimiter } from './config/rateLimit';
import { apiV1Router } from './routes';
import { getRoot } from './controllers/rootController';
import { notFoundHandler } from './middleware/notFoundHandler';
import { errorHandler } from './middleware/errorHandler';

/**
 * Crea la app Express sin ponerla a escuchar en ningún puerto — así los
 * tests (Supertest) pueden ejercitarla directamente sin abrir un socket real.
 * `server.ts` es el único lugar que llama `.listen(...)`.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(compression());
  // Límite explícito y conservador de tamaño de body — ningún endpoint
  // actual necesita más (el módulo de archivos, cuando exista, subirá
  // binarios por otra vía, nunca como JSON en este límite).
  app.use(express.json({ limit: '100kb' }));
  // Necesario para leer la cookie del refresh token (`POST /auth/refresh`,
  // `POST /auth/logout`) — no firma cookies (no hay ninguna cookie firmada
  // en este proyecto), solo las parsea.
  app.use(cookieParser());

  // Log HTTP de desarrollo/producción. No registra cookies ni el header
  // Authorization: los formatos 'dev'/'combined' de morgan solo incluyen
  // método, ruta, status y tiempo de respuesta. Silenciado en test para no
  // ensuciar la salida de las suites.
  if (!config.isTest) {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }

  app.get('/', getRoot);
  app.use('/api/v1', createImageRateLimiter(), createApiRateLimiter(), apiV1Router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
