import { config as loadDotenvFile } from 'dotenv';
import { resolve } from 'node:path';
import { loadEnv } from './env';

/**
 * Carga variables desde el .env centralizado en la raíz del monorepo.
 * Solo tiene efecto en desarrollo local: dotenv nunca sobrescribe variables
 * que ya existan en process.env, así que en producción (donde la plataforma
 * de despliegue — Render — inyecta las variables directamente) este paso es
 * un no-op silencioso si no encuentra el archivo.
 */
loadDotenvFile({ path: resolve(process.cwd(), '../.env') });

export const env = loadEnv(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  frontendUrl: env.FRONTEND_URL,
  /** Pooled — única variable de conexión que debe usar el runtime de la app (nunca DIRECT_URL, exclusiva de Prisma Migrate). */
  databaseUrl: env.DATABASE_URL,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  /** Puede faltar — `backend/src/auth/config.ts` es quien la exige de forma eager. */
  jwtAccessSecret: env.JWT_ACCESS_SECRET,
  accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL,
  refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL,
  /**
   * Cross-site real en producción (Netlify ≠ Render): sin config explícita,
   * usa "none" en producción (requiere Secure, ver config/cookies.ts) y
   * "lax" en desarrollo local (alcanza porque ahí no es cross-site).
   */
  cookieSameSite: env.COOKIE_SAME_SITE ?? (env.NODE_ENV === 'production' ? 'none' : 'lax'),
} as const;
