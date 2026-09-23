import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requireRole } from '../../middleware/requireRole';
import { AuthenticationRequiredError, ForbiddenError } from '../../errors/AppError';
import type { AuthContext } from '../../auth/types';

function makeReq(auth?: AuthContext): Request {
  return { auth } as unknown as Request;
}

function makeNext(): { next: NextFunction; calls: unknown[] } {
  const calls: unknown[] = [];
  const next = ((err?: unknown) => {
    calls.push(err);
  }) as NextFunction;
  return { next, calls };
}

describe('requireRole', () => {
  it('sin req.auth (requireAuth no corrió antes): AuthenticationRequiredError', () => {
    const { next, calls } = makeNext();
    requireRole('ADMIN')(makeReq(undefined), {} as Response, next);
    expect(calls[0]).toBeInstanceOf(AuthenticationRequiredError);
  });

  it('rol no incluido en la lista permitida: ForbiddenError', () => {
    const { next, calls } = makeNext();
    const req = makeReq({ userId: 'u1', sessionId: 's1', role: 'EMPLOYEE' });
    requireRole('ADMIN')(req, {} as Response, next);
    expect(calls[0]).toBeInstanceOf(ForbiddenError);
  });

  it('rol incluido: deja pasar (next sin error)', () => {
    const { next, calls } = makeNext();
    const req = makeReq({ userId: 'u1', sessionId: 's1', role: 'ADMIN' });
    requireRole('ADMIN')(req, {} as Response, next);
    expect(calls).toEqual([undefined]);
  });

  it('acepta múltiples roles permitidos', () => {
    const { next, calls } = makeNext();
    const req = makeReq({ userId: 'u1', sessionId: 's1', role: 'EMPLOYEE' });
    requireRole('ADMIN', 'EMPLOYEE')(req, {} as Response, next);
    expect(calls).toEqual([undefined]);
  });
});
