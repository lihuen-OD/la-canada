import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';
import {
  addGardenParticipant,
  listGardenCandidates,
  listGardenParticipants,
  resolveGardenActor,
  setGardenParticipantActive,
  type GardenActor,
  type RequestMeta,
} from '../kitchenGarden/gardenParticipants';
import {
  completeGardenActivity,
  createGardenActivity,
  getGardenWeeklyHistory,
  listGardenActivities,
  revertGardenCompletion,
  setGardenActivityActive,
  updateGardenActivity,
} from '../kitchenGarden/gardenActivitiesService';
import { getGardenPerformance } from '../kitchenGarden/gardenPerformanceService';
import {
  addParticipantBodySchema,
  completeGardenActivityBodySchema,
  createGardenActivityBodySchema,
  gardenActivityStatusBodySchema,
  gardenHistoryQuerySchema,
  gardenIdParamSchema,
  gardenPerformanceRangeSchema,
  listGardenActivitiesQuerySchema,
  participantStatusBodySchema,
  revertGardenActivityBodySchema,
  updateGardenActivityBodySchema,
} from '../kitchenGarden/gardenSchemas';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<GardenActor> {
  if (!req.auth) throw new AuthenticationRequiredError();
  return resolveGardenActor(req.auth);
}

/** Primer mensaje de validación de Zod — legible, nunca el objeto de error crudo. */
function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  fallback: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? fallback);
  return parsed.data;
}

const idFrom = (req: Request) =>
  parseOrThrow(gardenIdParamSchema, req.params.id, 'Identificador inválido.');

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

// ── Participantes ─────────────────────────────────────────────────────────

export async function getParticipants(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(res, 200, await listGardenParticipants());
}

export async function getParticipantCandidates(req: Request, res: Response): Promise<void> {
  send(res, 200, await listGardenCandidates(await actorFrom(req)));
}

export async function postParticipant(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const { userId } = parseOrThrow(addParticipantBodySchema, req.body, 'Elegí una persona.');
  send(res, 201, await addGardenParticipant(actor, userId, requestMeta(req)));
}

export async function patchParticipantStatus(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const { active } = parseOrThrow(participantStatusBodySchema, req.body, 'Falta active.');
  send(res, 200, await setGardenParticipantActive(actor, idFrom(req), active, requestMeta(req)));
}

// ── Actividades ───────────────────────────────────────────────────────────

export async function getActivities(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(listGardenActivitiesQuerySchema, req.query, 'Filtros inválidos.');
  send(res, 200, await listGardenActivities(actor, filters));
}

export async function postActivity(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createGardenActivityBodySchema, req.body, 'Datos inválidos.');
  send(res, 201, await createGardenActivity(actor, input, requestMeta(req)));
}

export async function patchActivity(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const id = idFrom(req);
  const input = parseOrThrow(updateGardenActivityBodySchema, req.body, 'Datos inválidos.');
  send(res, 200, await updateGardenActivity(actor, id, input, requestMeta(req)));
}

export async function patchActivityStatus(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const id = idFrom(req);
  const { active } = parseOrThrow(gardenActivityStatusBodySchema, req.body, 'Falta active.');
  send(res, 200, await setGardenActivityActive(actor, id, active, requestMeta(req)));
}

export async function postActivityCompletion(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const id = idFrom(req);
  const { participantId } = parseOrThrow(
    completeGardenActivityBodySchema,
    req.body ?? {},
    'Datos inválidos.',
  );
  send(res, 201, await completeGardenActivity(actor, id, participantId, requestMeta(req)));
}

export async function postActivityRevert(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const id = idFrom(req);
  const input = parseOrThrow(revertGardenActivityBodySchema, req.body, 'Datos inválidos.');
  send(res, 200, await revertGardenCompletion(actor, id, input, requestMeta(req)));
}

// ── Historial y Desempeño ─────────────────────────────────────────────────

export async function getHistory(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const params = parseOrThrow(gardenHistoryQuerySchema, req.query, 'Parámetros inválidos.');
  send(res, 200, await getGardenWeeklyHistory(actor, params));
}

export async function getPerformanceSummary(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const range = parseOrThrow(gardenPerformanceRangeSchema, req.query, 'Rango inválido.');
  send(res, 200, await getGardenPerformance(actor, range));
}

export async function getParticipantPerformance(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const range = parseOrThrow(gardenPerformanceRangeSchema, req.query, 'Rango inválido.');
  send(res, 200, await getGardenPerformance(actor, range, idFrom(req)));
}
