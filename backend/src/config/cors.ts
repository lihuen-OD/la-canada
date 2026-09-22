import type { CorsOptions } from 'cors';
import { config } from './index';
import { CorsOriginError } from '../errors/AppError';

/**
 * Acepta únicamente el origen definido en FRONTEND_URL, con credenciales
 * habilitadas (necesario para la futura sesión persistente vía cookie).
 * Nunca se usa origin:'*' junto con credentials:true.
 *
 * Las solicitudes sin header Origin (health checks, curl, llamadas
 * servidor-a-servidor) se permiten: no representan un navegador cross-origin.
 *
 * Un origen no autorizado se rechaza con un AppError operacional (403,
 * código estable CORS_ORIGIN_DENIED) — no con un Error genérico — para que
 * errorHandler lo trate como un rechazo esperado y no como un 500
 * inesperado. El paquete `cors` no agrega Access-Control-Allow-Origin
 * cuando el callback recibe un error, así que el origen rechazado nunca
 * ve ese header en la respuesta.
 */
export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || origin === config.frontendUrl) {
      callback(null, true);
      return;
    }
    callback(new CorsOriginError());
  },
  credentials: true,
};
