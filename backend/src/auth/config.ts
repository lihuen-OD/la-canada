import { createHmac } from 'node:crypto';
import { config } from '../config';

/**
 * `JWT_ACCESS_SECRET` ya es obligatoria a nivel de `config/env.ts` (única
 * fuente de verdad — falla ahí, temprano y claro, sin revelar su valor, si
 * falta). Este módulo solo convierte el valor ya validado a la forma que
 * `jose` espera (`Uint8Array`); no repite la validación de presencia/longitud.
 */
export const accessTokenSecret: Uint8Array = new TextEncoder().encode(config.jwtAccessSecret);
export const accessTokenTtlSeconds = config.accessTokenTtlSeconds;
export const refreshTokenTtlSeconds = config.refreshTokenTtlSeconds;

/**
 * Etapa 5R — clave de derivación de sucesoras de refresh
 * (`deriveSuccessorRefreshToken`). Derivada de `JWT_ACCESS_SECRET` con una
 * etiqueta propia (separación de dominio): no reutiliza el secreto crudo para
 * otro propósito y no agrega una variable de entorno más. Rotar
 * `JWT_ACCESS_SECRET` solo invalida los reenvíos pendientes, nunca las sesiones.
 */
export const refreshRotationKey: Uint8Array = createHmac('sha256', config.jwtAccessSecret)
  .update('la-canada:refresh-rotation:v1')
  .digest();
