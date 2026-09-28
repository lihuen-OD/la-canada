import { z } from 'zod';
import { personDisplayNameSchema } from '../lib/personName';
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

/**
 * Etapa 5U — alta de un ADMIN adicional. `.strict()`: el rol, el estado, el
 * username técnico, el `pinHash` y cualquier id los decide el backend; si el
 * cliente los manda, se rechaza. El PIN, igual que en el resto: string, sin
 * transformar (`'0123'` llega intacto).
 */
export const createAdminBodySchema = z
  .object({
    displayName: personDisplayNameSchema,
    pin: z.string({ message: PIN_MESSAGE }).regex(PIN_PATTERN, PIN_MESSAGE),
  })
  .strict();

/** Etapa 5U — un ADMIN corrige el nombre visible de otra cuenta sin Employee (p. ej. otro ADMIN). */
export const userDisplayNameBodySchema = z
  .object({ displayName: personDisplayNameSchema })
  .strict();

export const statusChangeBodySchema = z.object({
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  role: z.enum(['ADMIN', 'EMPLOYEE']).optional(),
});
