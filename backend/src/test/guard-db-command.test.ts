import { describe, expect, it } from 'vitest';
import { evaluateGuard, evaluateIsolation, neonEndpointOf } from '../scripts/guardDbCommand';

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

describe('rama de Neon aislada (--gate-isolated)', () => {
  // Conexiones SINTÉTICAS: solo importa la forma del host.
  const url = (endpoint: string, pooled: boolean) =>
    `postgresql://u:p@${endpoint}${pooled ? '-pooler' : ''}.sa-east-1.aws.neon.tech/neondb`;
  const DEMO = {
    DATABASE_TARGET: 'demo',
    DATABASE_URL: url('ep-demo-111', true),
    DIRECT_URL: url('ep-demo-111', false),
  };
  const ISOLATED = {
    DATABASE_TARGET: 'isolated',
    DATABASE_URL: url('ep-huerta-222', true),
    DIRECT_URL: url('ep-huerta-222', false),
    DRIVE_BACKUP_ENABLED: 'false',
    OBJECT_STORAGE_ENDPOINT: '',
  };
  const options = { varName: 'DIRECT_URL' as const, shape: 'direct' as const, gateTarget: false };

  it('el endpoint se lee del host, sin `-pooler` y sin exponer el resto', () => {
    expect(neonEndpointOf(url('ep-huerta-222', true))).toBe('ep-huerta-222');
    expect(neonEndpointOf(url('ep-huerta-222', false))).toBe('ep-huerta-222');
    expect(neonEndpointOf('no-es-una-url')).toBeNull();
    expect(neonEndpointOf(undefined)).toBeNull();
  });

  it('acepta una rama con endpoint propio, Drive y almacenamiento desactivados', () => {
    expect(evaluateGuard(ISOLATED, { ...options, gateIsolated: true }, DEMO)).toEqual({ ok: true });
  });

  it('DATABASE_TARGET=demo no alcanza: con el endpoint de demo se rechaza aunque diga "isolated"', () => {
    expect(evaluateIsolation({ ...DEMO }, DEMO).ok).toBe(false);
    const disguised = { ...ISOLATED, DATABASE_URL: DEMO.DATABASE_URL, DIRECT_URL: DEMO.DIRECT_URL };
    const result = evaluateIsolation(disguised, DEMO);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain('ep-demo-111');
  });

  it('rechaza conexiones a endpoints distintos entre sí, producción por nombre y la falta de referencia', () => {
    expect(evaluateIsolation({ ...ISOLATED, DIRECT_URL: url('ep-otra-333', false) }, DEMO).ok).toBe(
      false,
    );
    expect(evaluateIsolation({ ...ISOLATED, DATABASE_TARGET: 'production' }, DEMO).ok).toBe(false);
    expect(evaluateIsolation(ISOLATED, {}).ok).toBe(false);
  });

  it('exige la copia en Drive y el almacenamiento real desactivados', () => {
    expect(evaluateIsolation({ ...ISOLATED, DRIVE_BACKUP_ENABLED: 'true' }, DEMO).ok).toBe(false);
    expect(
      evaluateIsolation({ ...ISOLATED, OBJECT_STORAGE_ENDPOINT: 'https://storage.example' }, DEMO)
        .ok,
    ).toBe(false);
  });

  it('--gate-target conserva su regla de siempre (solo demo)', () => {
    expect(evaluateGuard(ISOLATED, { ...options, gateTarget: true }).ok).toBe(false);
    expect(evaluateGuard(DEMO, { ...options, gateTarget: true }).ok).toBe(true);
  });
});
