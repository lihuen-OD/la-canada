import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';
import {
  createStockCategoryBodySchema,
  createStockDestinationBodySchema,
  createStockItemBodySchema,
  createStockMovementBodySchema,
  listStockCategoriesQuerySchema,
  listStockDestinationsQuerySchema,
  listStockItemsQuerySchema,
  listStockMovementsQuerySchema,
  stockIdParamSchema,
  stockReportMovementsQuerySchema,
  stockReportSummaryQuerySchema,
  stockStatusBodySchema,
  updateStockCategoryBodySchema,
  updateStockDestinationBodySchema,
  updateStockItemBodySchema,
} from '../stock/stockSchemas';
import {
  createStockCategory,
  createStockDestination,
  createStockItem,
  createStockMovement,
  getStockItem as getStockItemDetail,
  listStockCategories,
  listStockDestinations,
  listStockItems,
  listStockMovements,
  resolveActor,
  setStockItemActive,
  updateStockCategory,
  updateStockDestination,
  updateStockItem,
  type RequestMeta,
  type StockActor,
} from '../stock/stockService';
import {
  exportStockReportCsv,
  getStockReportSummary,
  listStockReportMovements,
} from '../stock/stockReports';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<StockActor> {
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

function stockIdFrom(req: Request): string {
  return parseOrThrow(stockIdParamSchema, req.params.id, 'Identificador de producto inválido.');
}

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export async function getStockCategories(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(listStockCategoriesQuerySchema, req.query, 'Filtros inválidos.');
  send(res, 200, await listStockCategories(actor, filters));
}

export async function getStockItems(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(listStockItemsQuerySchema, req.query, 'Filtros inválidos.');
  send(res, 200, await listStockItems(actor, filters));
}

export async function getStockDestinations(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(
    listStockDestinationsQuerySchema,
    req.query,
    'Filtros de destinos inválidos.',
  );
  send(res, 200, await listStockDestinations(actor, filters));
}

export async function getStockItem(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(res, 200, await getStockItemDetail(stockIdFrom(req)));
}

export async function getStockItemMovements(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  const itemId = stockIdFrom(req);
  const filters = parseOrThrow(
    listStockMovementsQuerySchema,
    req.query,
    'Filtros de historial inválidos.',
  );
  send(res, 200, await listStockMovements(itemId, filters));
}

export async function postStockCategory(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(
    createStockCategoryBodySchema,
    req.body,
    'Datos de categoría inválidos.',
  );
  send(res, 201, await createStockCategory(actor, input, requestMeta(req)));
}

export async function patchStockCategory(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const categoryId = parseOrThrow(
    stockIdParamSchema,
    req.params.id,
    'Identificador de categoría inválido.',
  );
  const input = parseOrThrow(
    updateStockCategoryBodySchema,
    req.body,
    'Datos de categoría inválidos.',
  );
  send(res, 200, await updateStockCategory(actor, categoryId, input, requestMeta(req)));
}

export async function postStockDestination(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(
    createStockDestinationBodySchema,
    req.body,
    'Datos de destino inválidos.',
  );
  send(res, 201, await createStockDestination(actor, input, requestMeta(req)));
}

export async function patchStockDestination(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const destinationId = parseOrThrow(
    stockIdParamSchema,
    req.params.id,
    'Identificador de destino inválido.',
  );
  const input = parseOrThrow(
    updateStockDestinationBodySchema,
    req.body,
    'Datos de destino inválidos.',
  );
  send(res, 200, await updateStockDestination(actor, destinationId, input, requestMeta(req)));
}

export async function postStockItem(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createStockItemBodySchema, req.body, 'Datos de producto inválidos.');
  send(res, 201, await createStockItem(actor, input, requestMeta(req)));
}

export async function patchStockItem(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const itemId = stockIdFrom(req);
  const input = parseOrThrow(updateStockItemBodySchema, req.body, 'Datos de producto inválidos.');
  send(res, 200, await updateStockItem(actor, itemId, input, requestMeta(req)));
}

export async function patchStockItemStatus(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const itemId = stockIdFrom(req);
  const { active } = parseOrThrow(stockStatusBodySchema, req.body, 'El body debe incluir active.');
  send(res, 200, await setStockItemActive(actor, itemId, active, requestMeta(req)));
}

export async function postStockMovement(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const itemId = stockIdFrom(req);
  const input = parseOrThrow(
    createStockMovementBodySchema,
    req.body,
    'Datos de movimiento inválidos.',
  );
  // Header `Idempotency-Key` opcional (Etapa 5C.1). En replay se devuelve
  // exactamente el status + body almacenados, sin re-ejecutar la escritura.
  const idempotencyKey = req.header('idempotency-key') ?? undefined;
  const result = await createStockMovement(
    actor,
    itemId,
    input,
    requestMeta(req),
    undefined,
    idempotencyKey,
  );
  if (result.kind === 'replay') {
    send(res, result.status, result.body);
    return;
  }
  send(res, 201, { movement: result.movement, item: result.item });
}

export async function getStockReportSummaryHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(
    stockReportSummaryQuerySchema,
    req.query,
    'Filtros de reporte inválidos.',
  );
  send(res, 200, await getStockReportSummary(actor, filters));
}

export async function getStockReportMovementsHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(
    stockReportMovementsQuerySchema,
    req.query,
    'Filtros de reporte inválidos.',
  );
  send(res, 200, await listStockReportMovements(actor, filters));
}

/** CSV de movimientos (paridad con "📥 Exportar" del prototipo, para todo usuario autenticado). */
export async function getStockReportCsvHandler(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(
    stockReportSummaryQuerySchema,
    req.query,
    'Filtros de reporte inválidos.',
  );
  const { filename, content } = await exportStockReportCsv(actor, filters);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set(
    'Content-Disposition',
    `attachment; filename="consumos_lacanada.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.status(200).send(content);
}
