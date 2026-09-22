/**
 * Patrón explícito pedido para el seed: "crear el registro si no existe,
 * verificar su presencia si ya existe, no sobrescribir silenciosamente
 * datos que un administrador pudo modificar después". A propósito NO es un
 * upsert de Prisma: un upsert real correría la rama `update` con el payload
 * del seed cada vez que se re-ejecute, pisando cualquier cambio posterior.
 * Acá, si el registro ya existe, se devuelve tal cual está — nunca se
 * llama a `.update()`.
 */
export async function createIfMissing<T>(
  find: () => Promise<T | null>,
  create: () => Promise<T>,
): Promise<{ record: T; created: boolean }> {
  const existing = await find();
  if (existing) {
    return { record: existing, created: false };
  }
  const record = await create();
  return { record, created: true };
}

/**
 * Falla claramente ante una contradicción peligrosa (ver "Fallar
 * claramente si encuentra una contradicción peligrosa" en el pedido del
 * seed) — por ejemplo, un username ya existente pero vinculado a un
 * empleado distinto del esperado.
 */
export class SeedContradictionError extends Error {
  constructor(message: string) {
    super(`Contradicción peligrosa detectada en el seed: ${message}`);
    this.name = 'SeedContradictionError';
  }
}
