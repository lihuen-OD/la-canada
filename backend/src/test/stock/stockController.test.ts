import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createStockMovementMock, resolveActorMock } = vi.hoisted(() => ({
  createStockMovementMock: vi.fn(),
  resolveActorMock: vi.fn(),
}));

vi.mock('../../stock/stockService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stock/stockService')>()),
  createStockMovement: createStockMovementMock,
  resolveActor: resolveActorMock,
}));

import { postStockMovement } from '../../controllers/stockController';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'EMPLOYEE',
  employeeId: '33333333-3333-4333-8333-333333333333',
} as const;
const PUBLIC_BODY = {
  movement: {
    id: '44444444-4444-4444-8444-444444444444',
    type: 'INCOME',
    quantity: '1',
    effectiveDate: '2026-09-24',
    reason: null,
    employee: null,
    destination: null,
    createdAt: '2026-09-24T12:00:00.000Z',
  },
  item: {
    id: ITEM_ID,
    name: 'Producto sintético de controlador',
    area: 'HOUSE',
    unit: 'unidad',
    minimumQuantity: '1',
    currentQuantity: '2',
    stockLevel: 'ok',
    active: true,
    category: {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Categoría sintética',
      area: 'HOUSE',
    },
  },
};

function requestWithKey(idempotencyKey?: string): Request {
  return {
    auth: { userId: ACTOR.userId, sessionId: 'session-id', role: ACTOR.role },
    params: { id: ITEM_ID },
    body: { type: 'INCOME', quantity: '1' },
    ip: '127.0.0.1',
    header: vi.fn((name: string) => {
      if (name.toLowerCase() === 'idempotency-key') return idempotencyKey;
      if (name.toLowerCase() === 'user-agent') return 'vitest';
      return undefined;
    }),
  } as unknown as Request;
}

function responseRecorder() {
  const state: { status?: number; body?: unknown; cacheControl?: string } = {};
  const response = {
    set: vi.fn((name: string, value: string) => {
      if (name === 'Cache-Control') state.cacheControl = value;
      return response;
    }),
    status: vi.fn((status: number) => {
      state.status = status;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      state.body = body;
      return response;
    }),
  } as unknown as Response;
  return { response, state };
}

beforeEach(() => {
  createStockMovementMock.mockReset();
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(ACTOR);
});

describe('postStockMovement — contrato HTTP idempotente', () => {
  it('creación nueva devuelve 201 y solo el body público', async () => {
    createStockMovementMock.mockResolvedValue({ kind: 'created', ...PUBLIC_BODY });
    const { response, state } = responseRecorder();

    await postStockMovement(requestWithKey('controller-key-01'), response);

    expect(state).toEqual({ status: 201, body: PUBLIC_BODY, cacheControl: 'no-store' });
    expect(state.body).not.toHaveProperty('kind');
    expect(JSON.stringify(state.body)).not.toMatch(/requestHash|idempotencyRecord|token|pinHash/);
    expect(createStockMovementMock).toHaveBeenCalledWith(
      ACTOR,
      ITEM_ID,
      { type: 'INCOME', quantity: '1' },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' },
      undefined,
      'controller-key-01',
    );
  });

  it('replay devuelve exactamente el status y body almacenados, sin serializar kind', async () => {
    createStockMovementMock.mockResolvedValue({ kind: 'replay', status: 201, body: PUBLIC_BODY });
    const { response, state } = responseRecorder();

    await postStockMovement(requestWithKey('controller-key-01'), response);

    expect(state).toEqual({ status: 201, body: PUBLIC_BODY, cacheControl: 'no-store' });
    expect(state.body).not.toHaveProperty('kind');
  });

  it('sin header conserva el contrato 5A y pasa undefined al servicio', async () => {
    createStockMovementMock.mockResolvedValue({ kind: 'created', ...PUBLIC_BODY });
    const { response, state } = responseRecorder();

    await postStockMovement(requestWithKey(), response);

    expect(state.status).toBe(201);
    expect(state.body).toEqual(PUBLIC_BODY);
    expect(createStockMovementMock.mock.calls[0]?.[5]).toBeUndefined();
  });
});
