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
