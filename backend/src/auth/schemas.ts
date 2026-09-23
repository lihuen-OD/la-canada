import { z } from 'zod';

/**
 * `password` acá usa un máximo generoso (no el máximo de política, 128) —
 * el login debe poder rechazar por credenciales inválidas una contraseña
 * vieja que ya no cumpliera una política futura, no por un límite de
 * tamaño demasiado ajustado. Sí acota el tamaño máximo de entrada (defensa
 * básica), la política real de longitud se aplica en activate/reset.
 */
export const loginBodySchema = z.object({
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(256),
});

export const activateBodySchema = z.object({
  password: z.string().min(1).max(256),
});

export const resetPasswordBodySchema = z.object({
  password: z.string().min(1).max(256),
});

export const statusChangeBodySchema = z.object({
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  role: z.enum(['ADMIN', 'EMPLOYEE']).optional(),
});
