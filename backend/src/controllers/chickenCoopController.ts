import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';
import {
  adjustChickenCoopHensBodySchema,
  chickenCoopIdParamSchema,
  chickenCoopSummaryQuerySchema,
  configureChickenCoopBodySchema,
  createEggCollectionBodySchema,
  eggCollectionHistoryQuerySchema,
} from '../chickenCoop/chickenCoopSchemas';
import {
  adjustChickenCoopHens,
  configureChickenCoop,
  createEggCollection,
  getChickenCoopSummary,
  listEggCollectionHistory,
  resolveActor,
  voidEggCollection,
  type ChickenCoopActor,
  type RequestMeta,
} from '../chickenCoop/chickenCoopService';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<ChickenCoopActor> {
  if (!req.auth) throw new AuthenticationRequiredError();
  return resolveActor(req.auth);
}

/** Primer mensaje de validación de Zod — legible, nunca el objeto de error crudo. */
function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  fallback: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? fallback);
  }
  return parsed.data;
}

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export async function getChickenCoopSummaryHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(chickenCoopSummaryQuerySchema, req.query, 'Período inválido.');
  send(res, 200, await getChickenCoopSummary(actor, filters));
}

export async function getEggCollectionHistoryHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(
    eggCollectionHistoryQuerySchema,
    req.query,
    'Filtros de historial inválidos.',
  );
  send(res, 200, await listEggCollectionHistory(actor, filters));
}

export async function postEggCollection(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(
    createEggCollectionBodySchema,
    req.body,
    'Datos de recolección inválidos.',
  );
  // Header `Idempotency-Key` opcional: en replay se devuelven el status y el
  // body almacenados, sin volver a escribir.
  const idempotencyKey = req.header('idempotency-key') ?? undefined;
  const result = await createEggCollection(
    actor,
    input,
    requestMeta(req),
    undefined,
    idempotencyKey,
  );
  if (result.kind === 'replay') {
    send(res, result.status, result.body);
    return;
  }
  send(res, 201, result.body);
}

export async function postVoidEggCollection(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const collectionId = parseOrThrow(
    chickenCoopIdParamSchema,
    req.params.id,
    'Identificador de recolección inválido.',
  );
  send(res, 200, await voidEggCollection(actor, collectionId, requestMeta(req)));
}

export async function postChickenCoopConfiguration(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(
    configureChickenCoopBodySchema,
    req.body,
    'Datos de configuración inválidos.',
  );
  send(res, 201, await configureChickenCoop(actor, input, requestMeta(req)));
}

export async function postChickenCoopHensAdjustment(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(adjustChickenCoopHensBodySchema, req.body, 'Ajuste inválido.');
  send(res, 200, await adjustChickenCoopHens(actor, input, requestMeta(req)));
}
