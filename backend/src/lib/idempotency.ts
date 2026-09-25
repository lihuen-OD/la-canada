import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import {
  IdempotencyKeyConflictError,
  IdempotencyKeyInvalidError,
  IdempotencyRecordPendingError,
} from '../errors/AppError';
import { prisma } from './prisma';

/**
 * Idempotencia genérica sobre `idempotency_records` (Etapa 5G) — el mismo
 * contrato que Stock documentó en 5C.1 (docs/BUSINESS_RULES.md §8), para
 * endpoints nuevos. Stock conserva su implementación propia.
 *
 * En UNA transacción: reserva (actor, endpoint, clave) PRIMERO → escritura
 * de negocio → respuesta armada → registro completado. O confirma todo o no
 * queda nada. Una colisión con la reserva se resuelve leyendo el registro
 * DESPUÉS del rollback propio: replay exacto si la huella coincide, 409 si
 * el cuerpo es distinto, 409 pendiente si todavía no está completo. Nunca se
 * reejecuta la escritura a ciegas.
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const IDEMPOTENCY_UNIQUE_FIELDS = ['actor_user_id', 'endpoint', 'key'] as const;
const IDEMPOTENCY_UNIQUE_INDEX = 'idempotency_records_actor_user_id_endpoint_key_key';
const IDEMPOTENCY_TRANSACTION_TIMEOUT_MS = 15_000;

/** SHA-256 hex de una serialización canónica (array con orden fijo, sin secretos ni aleatoriedad). */
export function canonicalRequestHash(parts: readonly (string | number | null)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * P2002 exactamente sobre la reserva de idempotencia. Prisma 7 +
 * `@prisma/adapter-pg` informa la restricción en
 * `meta.driverAdapterError.cause.constraint`; otros engines en `meta.target`.
 */
export function isIdempotencyReservationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
      }
    | undefined;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const target = meta?.target ?? constraint?.fields;
  if (Array.isArray(target)) {
    return (
      target.length === IDEMPOTENCY_UNIQUE_FIELDS.length &&
      IDEMPOTENCY_UNIQUE_FIELDS.every((field) => target.includes(field))
    );
  }
  return target === IDEMPOTENCY_UNIQUE_INDEX || constraint?.index === IDEMPOTENCY_UNIQUE_INDEX;
}

export type IdempotentResult<T> =
  { kind: 'created'; body: T } | { kind: 'replay'; status: number; body: Prisma.JsonValue };

export interface IdempotentOperation<T extends Prisma.InputJsonValue> {
  actorUserId: string;
  /** Endpoint lógico canónico (UUID en minúsculas), p. ej. `POST /chicken-coop/collections`. */
  endpoint: string;
  key: string;
  requestHash: string;
  status: number;
  /** Escritura de negocio + respuesta, dentro de la transacción (consultas secuenciales). */
  run: (tx: Prisma.TransactionClient) => Promise<T>;
}

export function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new IdempotencyKeyInvalidError();
}

export async function executeIdempotent<T extends Prisma.InputJsonValue>(
  operation: IdempotentOperation<T>,
): Promise<IdempotentResult<T>> {
  const { actorUserId, endpoint, key, requestHash, status, run } = operation;
  assertIdempotencyKey(key);
  try {
    const body = await prisma.$transaction(
      async (tx) => {
        const record = await tx.idempotencyRecord.create({
          data: { actorUserId, endpoint, key, requestHash },
        });
        const response = await run(tx);
        await tx.idempotencyRecord.update({
          where: { id: record.id },
          data: { responseStatus: status, responseBody: response, completedAt: new Date() },
        });
        return response;
      },
      { timeout: IDEMPOTENCY_TRANSACTION_TIMEOUT_MS },
    );
    return { kind: 'created', body };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
      throw new IdempotencyRecordPendingError();
    }
    if (!isIdempotencyReservationConflict(error)) throw error;
    const record = await prisma.idempotencyRecord.findUnique({
      where: { actorUserId_endpoint_key: { actorUserId, endpoint, key } },
    });
    if (
      !record ||
      record.responseStatus === null ||
      record.responseBody === null ||
      record.completedAt === null
    ) {
      throw new IdempotencyRecordPendingError();
    }
    if (record.requestHash !== requestHash) throw new IdempotencyKeyConflictError();
    return { kind: 'replay', status: record.responseStatus, body: record.responseBody };
  }
}
