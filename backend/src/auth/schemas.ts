import { z } from 'zod';
import { PIN_PATTERN } from './pin';

const PIN_MESSAGE = 'El PIN debe tener exactamente 4 dígitos (0-9).';

/**
 * `z.string().regex(...)` — nunca `.trim()` ni ninguna otra transformación:
 * el PIN es un string, no un número, y un valor como `'0007'` debe llegar
 * intacto hasta el hash/verificación. Zod valida la forma tal cual llegó en
 * el JSON, sin normalizar nada.
 */
const pinSchema = z.string().regex(PIN_PATTERN, PIN_MESSAGE);

/**
 * El login ya no usa username+password (Etapa 3B.2): recibe el `id` (UUID)
 * del `User` elegido en el selector de identidad (`GET /auth/login-options`)
 * y su PIN de 4 dígitos.
 */
export const loginBodySchema = z.object({
  userId: z.string().uuid(),
  pin: pinSchema,
});

export const activateBodySchema = z.object({
  pin: pinSchema,
});

export const resetPinBodySchema = z.object({
  pin: pinSchema,
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
