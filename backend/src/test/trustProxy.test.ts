import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Etapa 5R — IP efectiva detrás de proxies. Supertest conecta desde
 * 127.0.0.1; los proxies se simulan con la cabecera `X-Forwarded-For` tal
 * como la dejarían (cada proxy agrega a la derecha la IP que vio). Los
 * limitadores reales se activan forzando `isTest: false`.
 */
const { trust } = vi.hoisted(() => ({ trust: { hops: 0 } }));

vi.mock('../config', async (importOriginal) => {
  const original = await importOriginal<typeof import('../config/index.js')>();
  return {
    ...original,
    config: {
      ...original.config,
      isTest: false,
      get trustProxyHops() {
        return trust.hops;
      },
    },
  };
});

import { loadEnv } from '../config/env';
import { configureTrustProxy } from '../config/trustProxy';
import { createApp } from '../app';

const BASE_ENV = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://usuario:clave@localhost:5432/sintetica',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
};

function ipEcho(hops: number) {
  const app = express();
  configureTrustProxy(app, hops);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

const ipFor = async (hops: number, forwardedFor?: string) => {
  const req = request(ipEcho(hops)).get('/ip');
  if (forwardedFor) void req.set('X-Forwarded-For', forwardedFor);
  return ((await req).body as { ip: string }).ip;
};

describe('TRUST_PROXY_HOPS', () => {
  it.each([
    ['', 0],
    ['0', 0],
    ['1', 1],
    ['2', 2],
    ['3', 3],
  ])('acepta %j → %i', (value, hops) => {
    expect(loadEnv({ ...BASE_ENV, TRUST_PROXY_HOPS: value }).TRUST_PROXY_HOPS).toBe(hops);
  });

  it('sin definir: 0 (no se confía en ninguna cabecera)', () => {
    expect(loadEnv(BASE_ENV).TRUST_PROXY_HOPS).toBe(0);
  });

  it.each(['true', 'loopback', '-1', '4', '1.5', 'uniquelocal'])(
    'rechaza %j: nunca una confianza indiscriminada ni por rangos',
    (value) => {
      expect(() => loadEnv({ ...BASE_ENV, TRUST_PROXY_HOPS: value })).toThrow(/TRUST_PROXY_HOPS/);
    },
  );
});

describe('IP efectiva (req.ip)', () => {
  it('0 saltos: una X-Forwarded-For del cliente se ignora; manda el socket', async () => {
    expect(await ipFor(0)).toMatch(/127\.0\.0\.1$/);
    expect(await ipFor(0, '203.0.113.7')).toMatch(/127\.0\.0\.1$/);
  });

  it('1 salto (balanceador de Render): la IP que agregó el proxy', async () => {
    expect(await ipFor(1, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('1 salto: una IP antepuesta por el cliente no se usa', async () => {
    expect(await ipFor(1, '198.51.100.99, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('2 saltos (Netlify + Render): el cliente real, ignorando lo que el cliente antepuso', async () => {
    // cliente-inventado, cliente real (agregado por Netlify), salida de Netlify (agregada por Render)
    expect(await ipFor(2, '198.51.100.99, 203.0.113.7, 192.0.2.10')).toBe('203.0.113.7');
  });

  it('2 saltos con acceso directo a Render (sin Netlify): el cliente elige su IP — por eso no es el valor por defecto', async () => {
    // Directo a Render: solo el balanceador agrega la IP real (192.0.2.55).
    expect(await ipFor(2, '198.51.100.1, 192.0.2.55')).toBe('198.51.100.1');
  });
});

describe('rate limit por IP efectiva (limitador de auth: 10 cada 15 min)', () => {
  const refreshFrom = (app: express.Express, forwardedFor: string) =>
    request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('X-Forwarded-For', forwardedFor);

  it('con 1 salto, dos clientes detrás del mismo proxy tienen cupos separados', async () => {
    trust.hops = 1;
    const app = createApp();
    for (let index = 0; index < 10; index += 1) {
      expect((await refreshFrom(app, '203.0.113.7')).status).toBe(401);
    }
    expect((await refreshFrom(app, '203.0.113.7')).status).toBe(429);
    expect((await refreshFrom(app, '203.0.113.8')).status).toBe(401);
  });

  it('con 1 salto, anteponer una IP inventada no da un cupo nuevo', async () => {
    trust.hops = 1;
    const app = createApp();
    for (let index = 0; index < 10; index += 1) {
      await refreshFrom(app, `198.51.100.${index}, 203.0.113.20`);
    }
    expect((await refreshFrom(app, '198.51.100.250, 203.0.113.20')).status).toBe(429);
  });

  it('con 0 saltos (local), una X-Forwarded-For falsificada no esquiva el límite', async () => {
    trust.hops = 0;
    const app = createApp();
    for (let index = 0; index < 10; index += 1) {
      await refreshFrom(app, `203.0.113.${index}`);
    }
    expect((await refreshFrom(app, '203.0.113.200')).status).toBe(429);
  });
});
