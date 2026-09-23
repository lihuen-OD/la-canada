import { config } from '../config';

/**
 * `JWT_ACCESS_SECRET` es opcional en el schema de Zod general (para no
 * bloquear health/CORS/tests que no necesitan auth — ver
 * `config/env.ts`), pero SÍ es obligatoria para el módulo de autenticación:
 * este archivo la exige de forma *eager*, al importarse, mismo patrón que
 * `lib/prisma.ts` con `DATABASE_URL` antes de la Etapa 3A. Las rutas de
 * auth se montan siempre (`routes/index.ts`), así que en la práctica el
 * servidor completo falla temprano y claro si falta — nunca revela su
 * valor en el mensaje.
 */
function resolveAccessTokenSecret(): Uint8Array {
  if (!config.jwtAccessSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET no está definida — la autenticación no puede inicializarse sin ella ' +
        '(ver .env.example). No se revela su contenido en este error.',
    );
  }
  return new TextEncoder().encode(config.jwtAccessSecret);
}

export const accessTokenSecret = resolveAccessTokenSecret();
export const accessTokenTtlSeconds = config.accessTokenTtlSeconds;
export const refreshTokenTtlSeconds = config.refreshTokenTtlSeconds;
