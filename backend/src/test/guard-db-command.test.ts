import { describe, expect, it } from 'vitest';
import { evaluateGuard } from '../scripts/guardDbCommand';

/**
 * `evaluateGuard` es pura (no lee `process.env` por sí misma) — se testea
 * con entornos sintéticos, sin depender de un `.env` real ni de Neon. Ver
 * `docs/ARCHITECTURE.md`, "Neon — rama demo", para el rol de esta guarda en
 * los scripts oficiales del proyecto.
 */
describe('evaluateGuard', () => {
  it('rechaza cuando DATABASE_TARGET es "production" (gateTarget=true) — producción rechazada por los scripts locales', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'production', DATABASE_URL: 'postgresql://u:p@host-pooler.neon.tech/db' },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(false);
  });

  it('rechaza cuando DATABASE_TARGET está ausente (gateTarget=true)', () => {
    const result = evaluateGuard(
      { DATABASE_URL: 'postgresql://u:p@host-pooler.neon.tech/db' },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(false);
  });

  it('acepta cuando DATABASE_TARGET=demo y la variable requerida tiene la forma pooled esperada', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'demo', DATABASE_URL: 'postgresql://u:p@host-pooler.neon.tech/db' },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(true);
  });

  it('rechaza cuando falta la variable requerida, aunque DATABASE_TARGET=demo', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'demo' },
      { varName: 'DIRECT_URL', shape: 'direct', gateTarget: true },
    );
    expect(result.ok).toBe(false);
  });

  it('rechaza cuando la forma no coincide: se esperaba direct y llegó pooled', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'demo', DIRECT_URL: 'postgresql://u:p@host-pooler.neon.tech/db' },
      { varName: 'DIRECT_URL', shape: 'direct', gateTarget: true },
    );
    expect(result.ok).toBe(false);
  });

  it('rechaza cuando la forma no coincide: se esperaba pooled y llegó direct', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'demo', DATABASE_URL: 'postgresql://u:p@host.neon.tech/db' },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(false);
  });

  it('un comando de solo lectura (gateTarget=false) igual falla si falta la variable — migración falla antes de ejecutarse si falta DIRECT_URL', () => {
    const result = evaluateGuard({}, { varName: 'DIRECT_URL', shape: 'direct', gateTarget: false });
    expect(result.ok).toBe(false);
  });

  it('un comando de solo lectura (gateTarget=false) acepta sin exigir DATABASE_TARGET', () => {
    const result = evaluateGuard(
      { DIRECT_URL: 'postgresql://u:p@host.neon.tech/db' },
      { varName: 'DIRECT_URL', shape: 'direct', gateTarget: false },
    );
    expect(result.ok).toBe(true);
  });

  it('ningún mensaje de error contiene un fragmento de connection string real (usuario, password u host)', () => {
    const result = evaluateGuard(
      {
        DATABASE_TARGET: 'production',
        DATABASE_URL: 'postgresql://realuser:realpass@ep-real-pooler.neon.tech/db',
      },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toMatch(/realuser|realpass|ep-real|neon\.tech/);
    }
  });

  it('el mensaje de error por variable ausente tampoco contiene ningún valor (porque no hay ninguno que revelar)', () => {
    const result = evaluateGuard(
      { DATABASE_TARGET: 'demo' },
      { varName: 'DATABASE_URL', shape: 'pooled', gateTarget: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/DATABASE_URL no está definida/);
    }
  });
});
