import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { z } from 'zod';
import {
  AuthenticationRequiredError,
  PetPhotoTooLargeError,
  ValidationError,
} from '../errors/AppError';
import {
  createPetBodySchema,
  createPetRecordBodySchema,
  createPetTypeBodySchema,
  listPetRecordsQuerySchema,
  listPetTypesQuerySchema,
  listPetsQuerySchema,
  petIdParamSchema,
  petTypeStatusBodySchema,
  updatePetBodySchema,
} from '../pets/petSchemas';
import {
  createPet,
  createPetRecord,
  createPetType,
  deactivatePetType,
  getPet,
  listPetRecords,
  listPetTypes,
  listPets,
  resolveActor,
  updatePet,
  voidPetRecord,
  type PetActor,
  type RequestMeta,
} from '../pets/petService';
import {
  MAX_PET_PHOTO_BYTES,
  PET_PHOTO_MIME_TYPES,
  readPetPhoto,
  removePetPhoto,
  uploadPetPhoto,
} from '../pets/petPhotoService';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<PetActor> {
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
  parseOrThrow(petIdParamSchema, value, `Identificador de ${label} inválido.`);

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

// ── Tipos ──

export async function getPetTypesHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(
    res,
    200,
    await listPetTypes(
      actor,
      parseOrThrow(listPetTypesQuerySchema, req.query, 'Filtros inválidos.'),
    ),
  );
}

export async function postPetType(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createPetTypeBodySchema, req.body, 'Datos de tipo inválidos.');
  send(res, 201, await createPetType(actor, input, requestMeta(req)));
}

export async function patchPetTypeStatus(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const typeId = idFrom(req.params.id, 'tipo');
  parseOrThrow(petTypeStatusBodySchema, req.body, 'Solo se admite { "active": false }.');
  send(res, 200, await deactivatePetType(actor, typeId, requestMeta(req)));
}

// ── Mascotas ──

export async function getPetsHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(
    res,
    200,
    await listPets(actor, parseOrThrow(listPetsQuerySchema, req.query, 'Filtros inválidos.')),
  );
}

export async function getPetHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(res, 200, await getPet(actor, idFrom(req.params.id, 'mascota')));
}

export async function postPet(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createPetBodySchema, req.body, 'Datos de mascota inválidos.');
  send(res, 201, await createPet(actor, input, requestMeta(req)));
}

export async function patchPet(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const petId = idFrom(req.params.id, 'mascota');
  const input = parseOrThrow(updatePetBodySchema, req.body, 'Datos de mascota inválidos.');
  send(res, 200, await updatePet(actor, petId, input, requestMeta(req)));
}

// ── Registros clínicos ──

export async function getPetRecordsHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const petId = idFrom(req.params.id, 'mascota');
  const filters = parseOrThrow(listPetRecordsQuerySchema, req.query, 'Filtros inválidos.');
  send(res, 200, await listPetRecords(actor, petId, filters));
}

export async function postPetRecord(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const petId = idFrom(req.params.id, 'mascota');
  const input = parseOrThrow(createPetRecordBodySchema, req.body, 'Datos de registro inválidos.');
  const result = await createPetRecord(
    actor,
    petId,
    input,
    requestMeta(req),
    undefined,
    req.header('idempotency-key') ?? undefined,
  );
  if (result.kind === 'replay') {
    send(res, result.status, result.body);
    return;
  }
  send(res, 201, result.body);
}

export async function postVoidPetRecord(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const petId = idFrom(req.params.id, 'mascota');
  const recordId = idFrom(req.params.recordId, 'registro');
  send(res, 200, await voidPetRecord(actor, petId, recordId, requestMeta(req)));
}

// ── Foto ──

const rawImageParser = express.raw({
  type: [...PET_PHOTO_MIME_TYPES],
  limit: MAX_PET_PHOTO_BYTES,
});

/** Cuerpo binario de la foto; un exceso de tamaño es un 413 propio, nunca un 500. */
export function parsePetPhotoBody(req: Request, res: Response, next: NextFunction): void {
  rawImageParser(req, res, (error?: unknown) => {
    if (error && (error as { type?: string }).type === 'entity.too.large') {
      next(new PetPhotoTooLargeError(MAX_PET_PHOTO_BYTES / (1024 * 1024)));
      return;
    }
    next(error as Error | undefined);
  });
}

export async function postPetPhoto(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const petId = idFrom(req.params.id, 'mascota');
  const result = await uploadPetPhoto(
    actor,
    petId,
    {
      body: req.body,
      declaredType: req.header('content-type'),
      filename: req.header('x-file-name'),
    },
    requestMeta(req),
  );
  send(res, 201, result);
}

export async function postRemovePetPhoto(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  send(res, 200, await removePetPhoto(actor, idFrom(req.params.id, 'mascota'), requestMeta(req)));
}

/** Imagen servida por el backend. El id del archivo es inmutable: caché privada larga. */
export async function getPetPhotoHandler(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  const photo = await readPetPhoto(idFrom(req.params.fileId, 'foto'));
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.set('Content-Type', photo.mimeType);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'");
  if (photo.etag) res.set('ETag', `"${photo.etag}"`);
  res.status(200).send(photo.body);
}
