import { describe, expect, it } from 'vitest';
import { createPrismaClient } from '../lib/prisma';

/**
 * `createPrismaClient` es una fábrica pura (mismo patrón que `loadEnv` en
 * `config/env.ts`) — se testea con valores sintéticos, sin depender de
 * `process.env` ni de una conexión real. Construir un `PrismaClient` con el
 * adapter de `pg` no abre ninguna conexión de red por sí solo (es lazy);
 * estos tests no tocan Neon.
 */
describe('createPrismaClient', () => {
  it('lanza un error claro cuando falta la connection string, sin revelar ningún valor', () => {
    expect(() => createPrismaClient(undefined)).toThrow(/DATABASE_URL no está definida/);
  });

  it('el mensaje de error nunca incluye una connection string ni la palabra "postgres" de un valor real', () => {
    try {
      createPrismaClient(undefined);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(String(error)).not.toMatch(/postgres(ql)?:\/\//i);
    }
  });

  it('construye el cliente sin lanzar cuando la connection string está presente (no conecta, solo instancia)', () => {
    expect(() => createPrismaClient('postgresql://user:pass@localhost:5432/db')).not.toThrow();
  });
});
