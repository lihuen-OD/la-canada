import { Prisma } from '../generated/prisma/client';
import { prisma } from './prisma';

/**
 * Violación de clave foránea (Postgres 23503). Con Prisma 7 + `adapter-pg`
 * llega como `P2003`; se contempla también el código del driver adapter.
 * Se usa SOLO dentro de un flujo que conoce la entidad involucrada (la
 * eliminación de abajo, o un servicio con su propia traducción de dominio):
 * nunca como mapeo global, que ocultaría bugs o relaciones mal armadas.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2003') return true;
  const meta = error.meta as
    { driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } } } | undefined;
  const cause = meta?.driverAdapterError?.cause;
  return cause?.kind === 'ForeignKeyConstraintViolation' || cause?.originalCode === '23503';
}

/**
 * Receta común de eliminación definitiva: corre `run` en una transacción
 * (verificación de dependencias con `count`, auditoría con snapshot y
 * `deleteMany` condicionado adentro). Si entre el conteo y el borrado otra
 * transacción agregó una dependencia, la clave foránea lo rechaza y se
 * responde con el MISMO error `*_IN_USE` de la entidad (`inUse`), como si se
 * hubiera detectado antes. Cualquier otro error sigue su curso sin traducir.
 */
export async function runEntityDeletion(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
  inUse: () => Error,
): Promise<void> {
  try {
    await prisma.$transaction(run);
  } catch (error) {
    if (isForeignKeyViolation(error)) throw inUse();
    throw error;
  }
}
