import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { createFakePrisma as CreateFakePrisma } from './fakePrisma';

/**
 * `requireAuth` importa el cliente Prisma singleton directamente (no lo
 * recibe inyectado) — a diferencia de `authService.ts`, acá sí hace falta
 * `vi.mock`. El contenedor vacío se crea con `vi.hoisted` (sin importar
 * nada — `vi.mock` se hoistea por encima de los imports, así que no puede
 * depender de una variable asignada por un `import` normal); el factory de
 * `vi.mock` es ASYNC y usa `import()` dinámico (Vitest sí lo resuelve para
 * archivos `.ts`, a diferencia de `require`, que falla en este runtime) y
 * llena el contenedor ahí. Para cuando el resto de este archivo importa
 * `requireAuth` (que importa `lib/prisma`, mockeado), la resolución async
 * del mock ya terminó — ES modules esperan a que todo el grafo de imports
 * se resuelva antes de ejecutar el código propio del archivo.
 */
const container: { fake?: ReturnType<typeof CreateFakePrisma> } = vi.hoisted(() => ({}));

vi.mock('../../lib/prisma', async () => {
  const { createFakePrisma } = await import('./fakePrisma.js');
  const fakeInstance = createFakePrisma();
  container.fake = fakeInstance;
  return { prisma: fakeInstance.prisma };
});

import { requireAuth } from '../../middleware/requireAuth';
import { accessTokenSecret } from '../../auth/config';
import { signAccessToken } from '../../auth/tokens';
import {
  AuthenticationRequiredError,
  ExpiredAccessTokenError,
  InvalidAccessTokenError,
} from '../../errors/AppError';

function fake() {
  if (!container.fake) throw new Error('fake prisma no inicializado todavía');
  return container.fake;
}

function makeReq(authorizationHeader?: string): Request {
  return {
    header: (name: string) =>
      name.toLowerCase() === 'authorization' ? authorizationHeader : undefined,
    auth: undefined,
  } as unknown as Request;
}

function makeNext(): { next: NextFunction; calls: unknown[] } {
  const calls: unknown[] = [];
  const next = ((err?: unknown) => {
    calls.push(err);
  }) as NextFunction;
  return { next, calls };
}

beforeEach(() => {
  fake().users.clear();
  fake().sessions.clear();
});

describe('requireAuth', () => {
  it('sin header Authorization: AuthenticationRequiredError', async () => {
    const req = makeReq(undefined);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('header con formato inválido (sin "Bearer "): AuthenticationRequiredError', async () => {
    const req = makeReq('esto-no-es-bearer');
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('token con firma inválida: InvalidAccessTokenError', async () => {
    const req = makeReq('Bearer token.invalido.acá');
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(InvalidAccessTokenError);
  });

  it('token vencido: ExpiredAccessTokenError', async () => {
    const token = await signAccessToken(
      { userId: crypto.randomUUID(), sessionId: crypto.randomUUID(), role: 'EMPLOYEE' },
      accessTokenSecret,
      -10,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(ExpiredAccessTokenError);
  });

  it('sesión inexistente en base (aunque el token sea válido): AuthenticationRequiredError', async () => {
    const token = await signAccessToken(
      { userId: crypto.randomUUID(), sessionId: crypto.randomUUID(), role: 'EMPLOYEE' },
      accessTokenSecret,
      60,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('sesión revocada: AuthenticationRequiredError', async () => {
    const userId = crypto.randomUUID();
    await fake().prisma.user.create({
      data: { id: userId, username: 'u1', role: 'EMPLOYEE', status: 'ACTIVE', pinHash: 'x' },
    });
    const session = await fake().prisma.session.create({
      data: {
        userId,
        refreshTokenHash: 'hash1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
    });
    const token = await signAccessToken(
      { userId, sessionId: session.id, role: 'EMPLOYEE' },
      accessTokenSecret,
      60,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('usuario suspendido (aunque el access token siga sin vencer): AuthenticationRequiredError', async () => {
    const userId = crypto.randomUUID();
    await fake().prisma.user.create({
      data: {
        id: userId,
        username: 'u1',
        role: 'EMPLOYEE',
        status: 'SUSPENDED',
        pinHash: 'x',
      },
    });
    const session = await fake().prisma.session.create({
      data: { userId, refreshTokenHash: 'hash2', expiresAt: new Date(Date.now() + 60_000) },
    });
    const token = await signAccessToken(
      { userId, sessionId: session.id, role: 'EMPLOYEE' },
      accessTokenSecret,
      60,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('token + sesión + usuario válidos: adjunta req.auth con el rol vigente en base (no el del JWT)', async () => {
    const userId = crypto.randomUUID();
    await fake().prisma.user.create({
      data: { id: userId, username: 'u1', role: 'ADMIN', status: 'ACTIVE', pinHash: 'x' },
    });
    const session = await fake().prisma.session.create({
      data: { userId, refreshTokenHash: 'hash3', expiresAt: new Date(Date.now() + 60_000) },
    });
    // El JWT dice EMPLOYEE a propósito — requireAuth debe ignorar ese claim y usar el rol de la base (ADMIN).
    const token = await signAccessToken(
      { userId, sessionId: session.id, role: 'EMPLOYEE' },
      accessTokenSecret,
      60,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls).toEqual([undefined]);
    expect(req.auth).toEqual({ userId, sessionId: session.id, role: 'ADMIN' });
  });

  it('JWT firmado correctamente pero cuyo sub no es el dueño real de la sesión (sid): AuthenticationRequiredError', async () => {
    const ownerUserId = crypto.randomUUID();
    const impersonatedUserId = crypto.randomUUID();
    await fake().prisma.user.create({
      data: {
        id: ownerUserId,
        username: 'dueño-real',
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        pinHash: 'x',
      },
    });
    await fake().prisma.user.create({
      data: {
        id: impersonatedUserId,
        username: 'otro-usuario',
        role: 'ADMIN',
        status: 'ACTIVE',
        pinHash: 'x',
      },
    });
    // La sesión pertenece de verdad a `ownerUserId` — el token, sin embargo,
    // firma criptográficamente válida (misma clave real) incluida, dice ser
    // de `impersonatedUserId`. Ninguna de las dos identidades por sí sola
    // (firma válida, sesión activa) alcanza si no coinciden entre sí.
    const session = await fake().prisma.session.create({
      data: {
        userId: ownerUserId,
        refreshTokenHash: 'hash-sub-sid-mismatch',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const token = await signAccessToken(
      { userId: impersonatedUserId, sessionId: session.id, role: 'ADMIN' },
      accessTokenSecret,
      60,
    );
    const req = makeReq(`Bearer ${token}`);
    const { next, calls } = makeNext();
    await requireAuth(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
    expect(req.auth).toBeUndefined();
  });
});
