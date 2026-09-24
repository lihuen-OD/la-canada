import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';
import {
  completeTaskBodySchema,
  createTaskBodySchema,
  listTasksQuerySchema,
  revertTaskBodySchema,
  taskHistoryQuerySchema,
  taskIdParamSchema,
  taskStatusBodySchema,
  updateTaskBodySchema,
} from '../tasks/taskSchemas';
import {
  completeTask,
  createTask,
  getWeeklyHistory,
  listTaskEmployees,
  listTasks,
  resolveActor,
  revertTaskCompletion,
  setTaskActive,
  updateTask,
  type RequestMeta,
  type TaskActor,
} from '../tasks/tasksService';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

async function actorFrom(req: Request): Promise<TaskActor> {
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

function taskIdFrom(req: Request): string {
  return parseOrThrow(taskIdParamSchema, req.params.id, 'Identificador de tarea inválido.');
}

function send(res: Response, status: number, body: unknown): void {
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export async function getTasks(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const filters = parseOrThrow(listTasksQuerySchema, req.query, 'Filtros inválidos.');
  send(res, 200, await listTasks(actor, filters));
}

export async function getTaskEmployees(req: Request, res: Response): Promise<void> {
  await actorFrom(req);
  send(res, 200, await listTaskEmployees());
}

export async function getTaskHistory(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const params = parseOrThrow(
    taskHistoryQuerySchema,
    req.query,
    'Parámetros de historial inválidos.',
  );
  send(res, 200, await getWeeklyHistory(actor, params));
}

export async function postTask(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const input = parseOrThrow(createTaskBodySchema, req.body, 'Datos de tarea inválidos.');
  send(res, 201, await createTask(actor, input, requestMeta(req)));
}

export async function patchTask(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const taskId = taskIdFrom(req);
  const input = parseOrThrow(updateTaskBodySchema, req.body, 'Datos de tarea inválidos.');
  send(res, 200, await updateTask(actor, taskId, input, requestMeta(req)));
}

export async function patchTaskStatus(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const taskId = taskIdFrom(req);
  const { active } = parseOrThrow(taskStatusBodySchema, req.body, 'El body debe incluir active.');
  send(res, 200, await setTaskActive(actor, taskId, active, requestMeta(req)));
}

export async function postTaskCompletion(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const taskId = taskIdFrom(req);
  const { employeeId } = parseOrThrow(completeTaskBodySchema, req.body ?? {}, 'Datos inválidos.');
  send(res, 201, await completeTask(actor, taskId, employeeId, requestMeta(req)));
}

export async function postTaskRevert(req: Request, res: Response): Promise<void> {
  const actor = await actorFrom(req);
  const taskId = taskIdFrom(req);
  const input = parseOrThrow(revertTaskBodySchema, req.body, 'Datos de reversión inválidos.');
  send(res, 200, await revertTaskCompletion(actor, taskId, input, requestMeta(req)));
}
