import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { z } from 'zod';
import {
  AuthenticationRequiredError,
  PetPhotoTooLargeError,
  ValidationError,
} from '../errors/AppError';
import { resolveActor, type RequestMeta, type TaskActor } from '../tasks/tasksService';
import {
  createChildBodySchema,
  createEmployeeBodySchema,
  createEventBodySchema,
  createFamilyMemberBodySchema,
  createNewsBodySchema,
  employeeStatusBodySchema,
  familyStatusBodySchema,
  idParamSchema,
  listEventsQuerySchema,
  listNewsQuerySchema,
  listPhotosQuerySchema,
  teamProfilesQuerySchema,
  updateEmployeeBodySchema,
  updateEventBodySchema,
  updateFamilyMemberBodySchema,
  updatePersonalProfileBodySchema,
  updateProfileBodySchema,
  uploadPhotoQuerySchema,
} from '../more/moreSchemas';
import { createNews, listNews } from '../more/newsService';
import { createEvent, deleteEvent, listEvents, updateEvent } from '../more/eventsService';
import { getWeather } from '../more/weatherService';
import {
  MAX_GARDEN_PLAN_BYTES,
  findReadableGardenPlanVersion,
  listGardenPlanVersions,
  publishGardenPlanVersion,
  readGardenPlanObject,
} from '../more/gardenService';
import { listGardenVersionsQuerySchema } from '../more/moreSchemas';
import {
  MAX_GALLERY_PHOTO_BYTES,
  deletePhoto,
  findReadablePhoto,
  listPhotos,
  readPhotoObject,
  uploadPhoto,
} from '../more/photosService';
import {
  createEmployee,
  listEmployees,
  listTeamProfiles,
  setEmployeeActive,
  updateEmployee,
} from '../more/employeesService';
import { addMyChild, getMyProfile, removeMyChild, updateMyProfile } from '../more/profileService';
import {
  createFamilyMember,
  deleteFamilyMember,
  listMyFamily,
  setFamilyMemberActive,
  updateFamilyMember,
  updatePersonalProfile,
} from '../more/familyService';
import { getMoreSummary } from '../more/summaryService';
import { PET_PHOTO_MIME_TYPES } from '../pets/petPhotoService';

/** ☰ Más (Etapa 5X). Los permisos por rol se deciden en cada servicio (rol leído de la base). */

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<TaskActor> {
  if (!req.auth) throw new AuthenticationRequiredError();
  return resolveActor(req.auth);
}

function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  fallback: string,
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? fallback);
  return parsed.data;
}

const idFrom = (value: unknown, label: string) =>
  parseOrThrow(idParamSchema, value, `Identificador de ${label} inválido.`);
const idempotencyKeyOf = (req: Request) => req.header('idempotency-key') ?? undefined;

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

// ── Resumen de la grilla ──

export async function getMoreSummaryHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(res, 200, await getMoreSummary());
}

// ── 📝 Novedades ──

export async function getNewsHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(
    res,
    200,
    await listNews(parseOrThrow(listNewsQuerySchema, req.query, 'Filtros inválidos.')),
  );
}

export async function postNewsHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createNewsBodySchema, req.body, 'Datos de la novedad inválidos.');
  const result = await createNews(actor, input, requestMeta(req), idempotencyKeyOf(req));
  send(res, result.kind === 'replay' ? result.status : 201, result.body);
}

// ── 📅 Eventos ──

export async function getEventsHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(
    res,
    200,
    await listEvents(actor, parseOrThrow(listEventsQuerySchema, req.query, 'Filtros inválidos.')),
  );
}

export async function postEventHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createEventBodySchema, req.body, 'Datos del evento inválidos.');
  send(res, 201, await createEvent(actor, input, requestMeta(req)));
}

export async function patchEventHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const eventId = idFrom(req.params.id, 'evento');
  const input = parseOrThrow(updateEventBodySchema, req.body, 'Datos del evento inválidos.');
  send(res, 200, await updateEvent(actor, eventId, input, requestMeta(req)));
}

export async function postDeleteEventHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(res, 200, await deleteEvent(actor, idFrom(req.params.id, 'evento'), requestMeta(req)));
}

// ── 🌤️ Clima ──

export async function getWeatherHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(res, 200, await getWeather());
}

// ── 📸 Fotos ──

export async function getPhotosHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(
    res,
    200,
    await listPhotos(parseOrThrow(listPhotosQuerySchema, req.query, 'Filtros inválidos.')),
  );
}

const rawImageParser = express.raw({
  type: [...PET_PHOTO_MIME_TYPES],
  limit: MAX_GALLERY_PHOTO_BYTES,
});

/** Cuerpo binario de la foto; un exceso de tamaño es un 413 propio, nunca un 500. */
export function parseGalleryPhotoBody(req: Request, res: Response, next: NextFunction): void {
  rawImageParser(req, res, (error?: unknown) => {
    if (error && (error as { type?: string }).type === 'entity.too.large') {
      next(new PetPhotoTooLargeError(MAX_GALLERY_PHOTO_BYTES / (1024 * 1024)));
      return;
    }
    next(error as Error | undefined);
  });
}

export async function postPhotoHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const metadata = parseOrThrow(uploadPhotoQuerySchema, req.query, 'Datos de la foto inválidos.');
  const result = await uploadPhoto(
    actor,
    {
      body: req.body,
      declaredType: req.header('content-type'),
      filename: req.header('x-file-name'),
    },
    metadata,
    requestMeta(req),
    idempotencyKeyOf(req),
  );
  send(res, result.kind === 'replay' ? result.status : 201, result.body);
}

export async function postDeletePhotoHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(res, 200, await deletePhoto(actor, idFrom(req.params.id, 'foto'), requestMeta(req)));
}

/**
 * Imagen servida por el backend. El id es inmutable (una foto nueva es otro
 * archivo): caché privada larga y `ETag` = SHA-256 del contenido; un
 * `If-None-Match` que coincide responde 304 sin leer el bucket.
 */
export async function getPhotoContentHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  const file = await findReadablePhoto(idFrom(req.params.id, 'foto'));
  const etag = file.checksum ? `"${file.checksum}"` : null;
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'");
  if (etag) res.set('ETag', etag);
  const ifNoneMatch = req.header('if-none-match');
  if (etag && ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
    res.status(304).end();
    return;
  }
  const body = await readPhotoObject(file.objectKey);
  res.set('Content-Type', file.mimeType);
  res.status(200).send(body);
}

// ── 🌳 Jardín ──

export async function getGardenVersionsHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(
    res,
    200,
    await listGardenPlanVersions(
      parseOrThrow(listGardenVersionsQuerySchema, req.query, 'Filtros inválidos.'),
    ),
  );
}

const rawPlanParser = express.raw({
  type: [...PET_PHOTO_MIME_TYPES],
  limit: MAX_GARDEN_PLAN_BYTES,
});

/** Cuerpo binario del plano; un exceso de tamaño es un 413 propio, nunca un 500. */
export function parseGardenPlanBody(req: Request, res: Response, next: NextFunction): void {
  rawPlanParser(req, res, (error?: unknown) => {
    if (error && (error as { type?: string }).type === 'entity.too.large') {
      next(new PetPhotoTooLargeError(MAX_GARDEN_PLAN_BYTES / (1024 * 1024)));
      return;
    }
    next(error as Error | undefined);
  });
}

export async function postGardenVersionHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const result = await publishGardenPlanVersion(
    actor,
    {
      body: req.body,
      declaredType: req.header('content-type'),
      filename: req.header('x-file-name'),
    },
    requestMeta(req),
    idempotencyKeyOf(req),
  );
  send(res, result.kind === 'replay' ? result.status : 201, result.body);
}

/**
 * Plano servido por el backend. El id es el de la VERSIÓN y el archivo no
 * cambia nunca, así que caché privada larga e `ETag` = SHA-256 del contenido:
 * un `If-None-Match` que coincide responde 304 sin leer el bucket.
 */
export async function getGardenVersionContentHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  const file = await findReadableGardenPlanVersion(idFrom(req.params.id, 'versión del plano'));
  const etag = file.checksum ? `"${file.checksum}"` : null;
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'");
  if (etag) res.set('ETag', etag);
  const ifNoneMatch = req.header('if-none-match');
  if (etag && ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
    res.status(304).end();
    return;
  }
  const body = await readGardenPlanObject(file.objectKey);
  res.set('Content-Type', file.mimeType);
  res.status(200).send(body);
}

// ── ⚙️ Configuración (ADMIN) ──

export async function getEmployeesHandler(req: Request, res: Response): Promise<void> {
  send(res, 200, await listEmployees(await actorFrom(req)));
}

export async function postEmployeeHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createEmployeeBodySchema, req.body, 'Datos de la persona inválidos.');
  send(res, 201, await createEmployee(actor, input, requestMeta(req)));
}

export async function patchEmployeeHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const employeeId = idFrom(req.params.id, 'persona');
  const input = parseOrThrow(updateEmployeeBodySchema, req.body, 'Datos de la persona inválidos.');
  send(res, 200, await updateEmployee(actor, employeeId, input, requestMeta(req)));
}

export async function patchEmployeeStatusHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const employeeId = idFrom(req.params.id, 'persona');
  const { active } = parseOrThrow(
    employeeStatusBodySchema,
    req.body,
    'Solo se admite { "active": boolean }.',
  );
  send(res, 200, await setEmployeeActive(actor, employeeId, active, requestMeta(req)));
}

export async function getTeamProfilesHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const { filter } = parseOrThrow(teamProfilesQuerySchema, req.query, 'Filtro inválido.');
  send(res, 200, await listTeamProfiles(actor, filter));
}

// ── 👤 Mi perfil ──

export async function getMyProfileHandler(req: Request, res: Response): Promise<void> {
  send(res, 200, await getMyProfile(await actorFrom(req)));
}

/** El contrato depende de la sesión: ficha de equipo o perfil personal (sin Employee). */
export async function putMyProfileHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  if (!actor.employeeId) {
    const input = parseOrThrow(
      updatePersonalProfileBodySchema,
      req.body,
      'Datos del perfil inválidos.',
    );
    send(res, 200, await updatePersonalProfile(actor, input, requestMeta(req)));
    return;
  }
  const input = parseOrThrow(updateProfileBodySchema, req.body, 'Datos del perfil inválidos.');
  send(res, 200, await updateMyProfile(actor, input, requestMeta(req)));
}

export async function postMyChildHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createChildBodySchema, req.body, 'Datos del hijo inválidos.');
  const result = await addMyChild(actor, input, requestMeta(req), idempotencyKeyOf(req));
  send(res, result.kind === 'replay' ? result.status : 201, result.body);
}

export async function postRemoveMyChildHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(res, 200, await removeMyChild(actor, idFrom(req.params.id, 'hijo'), requestMeta(req)));
}

// ── 👨‍👩‍👧‍👦 Mi familia (usuario sin Employee; el propietario es siempre la sesión) ──

export async function getMyFamilyHandler(req: Request, res: Response): Promise<void> {
  send(res, 200, await listMyFamily(await actorFrom(req)));
}

export async function postMyFamilyHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(
    createFamilyMemberBodySchema,
    req.body,
    'Datos del familiar inválidos.',
  );
  const result = await createFamilyMember(actor, input, requestMeta(req), idempotencyKeyOf(req));
  send(res, result.kind === 'replay' ? result.status : 201, result.body);
}

export async function patchMyFamilyHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const memberId = idFrom(req.params.id, 'familiar');
  const input = parseOrThrow(
    updateFamilyMemberBodySchema,
    req.body,
    'Datos del familiar inválidos.',
  );
  send(res, 200, await updateFamilyMember(actor, memberId, input, requestMeta(req)));
}

export async function patchMyFamilyStatusHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const memberId = idFrom(req.params.id, 'familiar');
  const { active } = parseOrThrow(familyStatusBodySchema, req.body, 'El body debe incluir active.');
  send(res, 200, await setFamilyMemberActive(actor, memberId, active, requestMeta(req)));
}

/** `DELETE /me/family/:id` — un familiar cargado por error (los del seed solo se desactivan). */
export async function deleteMyFamilyHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  await deleteFamilyMember(actor, idFrom(req.params.id, 'familiar'), requestMeta(req));
  res.set('Cache-Control', 'no-store').status(204).end();
}
