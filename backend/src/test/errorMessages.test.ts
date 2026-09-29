import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { config } from '../config';
import * as errors from '../errors/AppError';
import { runEntityDeletion } from '../lib/deletion';
import { configureSpanishValidation } from '../lib/zodSpanish';
import { errorHandler, UNEXPECTED_ERROR_MESSAGE } from '../middleware/errorHandler';

const db = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('../lib/prisma', () => ({ prisma: db }));

const TECHNICAL =
  /prisma|postgres|\bsql\b|constraint|stack|failed to fetch|network error|unauthorized|forbidden|internal server error|content-type|idempotency-key|cors|token|payload|undefined|null\b/i;

function fkViolation(shape: Record<string, unknown> = { code: 'P2003' }) {
  return new Prisma.PrismaClientKnownRequestError(
    'insert or update violates foreign key constraint "x_fkey" on table "y"',
    {
      clientVersion: 'test',
      ...shape,
    } as ConstructorParameters<typeof Prisma.PrismaClientKnownRequestError>[1],
  );
}

function handle(error: unknown) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  errorHandler(error, {} as Request, res as unknown as Response, vi.fn());
  spy.mockRestore();
  return { status: res.status.mock.calls[0]?.[0], body: res.json.mock.calls[0]?.[0] };
}

describe('P2003 acotado a la eliminación', () => {
  it('no existe mapeo global: un P2003 fuera de un DELETE es un error inesperado genérico', () => {
    const { status, body } = handle(fkViolation());
    expect(status).toBe(500);
    expect(body.error.message).toBe(UNEXPECTED_ERROR_MESSAGE);
    expect(body.error.code).toBeUndefined();
    expect(JSON.stringify(body.error.message)).not.toMatch(
      /CONCURRENT_CHANGE|constraint|fkey|table/,
    );
  });

  it('en producción no se expone stack ni detalle de Postgres', () => {
    const original = config.isProduction;
    (config as { isProduction: boolean }).isProduction = true;
    try {
      const { body } = handle(fkViolation());
      expect(body).toEqual({ error: { message: UNEXPECTED_ERROR_MESSAGE } });
    } finally {
      (config as { isProduction: boolean }).isProduction = original;
    }
  });

  it.each([
    ['P2003', { code: 'P2003' }],
    [
      'driver adapter 23503',
      { code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23503' } } } },
    ],
  ])(
    'dentro de runEntityDeletion (%s) se traduce al *_IN_USE que indica la entidad',
    async (_l, shape) => {
      db.$transaction.mockRejectedValueOnce(fkViolation(shape));
      await expect(
        runEntityDeletion(
          async () => undefined,
          () => new errors.TaskInUseError(),
        ),
      ).rejects.toMatchObject({ statusCode: 409, code: 'TASK_IN_USE' });
    },
  );

  it('runEntityDeletion no traduce otros errores', async () => {
    const other = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2025',
      clientVersion: 't',
    });
    db.$transaction.mockRejectedValueOnce(other);
    await expect(
      runEntityDeletion(
        async () => undefined,
        () => new errors.TaskInUseError(),
      ),
    ).rejects.toBe(other);
  });

  it('el errorHandler ya no importa el helper de FK', () => {
    const source = readFileSync(resolve(__dirname, '../middleware/errorHandler.ts'), 'utf8');
    expect(source).not.toMatch(/isForeignKeyViolation|P2003|CONCURRENT_CHANGE/);
  });
});

describe('mensajes públicos en español', () => {
  const instances = (Object.values(errors) as unknown[])
    .filter(
      (value): value is typeof errors.AppError =>
        typeof value === 'function' &&
        (value as { prototype?: unknown }).prototype instanceof errors.AppError,
    )
    .map((ErrorClass) => {
      const Build = ErrorClass as unknown as new (arg?: unknown) => errors.AppError;
      try {
        // Sin argumentos usa el mensaje por defecto; los que interpolan un número (MB) reciben 5.
        const error = new Build();
        return /undefined/.test(error.message) ? new Build(5) : error;
      } catch {
        return null;
      }
    })
    // Los que exigen el mensaje (ValidationError…) se cubren por sus llamadas y por Zod.
    .filter((error): error is errors.AppError => error !== null && error.message !== '');

  it('cada AppError tiene mensaje humano en español, sin términos técnicos, y código estable', () => {
    expect(instances.length).toBeGreaterThan(50);
    for (const error of instances) {
      expect(error.message, error.name).not.toMatch(TECHNICAL);
      expect(error.message, error.name).toMatch(/[.?!]$/);
      if (error.code) expect(error.code, error.name).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it.each([
    [
      'TaskInUseError',
      'No se puede eliminar esta tarea porque tiene actividad registrada. Podés desactivarla para conservar su historial.',
    ],
    [
      'StockCategoryHasItemsError',
      'No se puede eliminar esta categoría porque tiene productos asociados. Primero reasigná los productos o desactivá la categoría.',
    ],
    [
      'StockItemInUseError',
      'No se puede eliminar este producto porque tiene movimientos de stock. Podés desactivarlo para conservar el historial.',
    ],
    [
      'StockDestinationInUseError',
      'No se puede eliminar este destino porque fue utilizado en movimientos de stock. Podés desactivarlo.',
    ],
    [
      'PetTypeInUseError',
      'No se puede eliminar este tipo porque está asociado a una o más mascotas. Podés desactivarlo.',
    ],
    [
      'PetTypeBuiltinError',
      'Este tipo forma parte de la configuración inicial y no se puede eliminar.',
    ],
    [
      'AnimalInUseError',
      'No se puede eliminar esta mascota porque tiene registros o fotos. Podés desactivarla para conservar su historia.',
    ],
    ['AuthenticationRequiredError', 'Tu sesión venció. Volvé a ingresar.'],
    ['ForbiddenError', 'No tenés permiso para realizar esta acción.'],
  ] as const)('%s → texto acordado', (name, message) => {
    const ErrorClass = errors[name] as unknown as new () => errors.AppError;
    expect(new ErrorClass().message).toBe(message);
  });

  it('el rate limit responde en español con RATE_LIMITED', () => {
    const source = readFileSync(resolve(__dirname, '../config/rateLimit.ts'), 'utf8');
    expect(source).toContain(
      'Realizaste demasiados intentos. Esperá unos minutos antes de volver a intentar.',
    );
    // General, imágenes, health (Etapa 5R) y auth: los cuatro con el mismo código.
    expect(source.match(/code: 'RATE_LIMITED'/g)).toHaveLength(4);
  });

  it('Zod sin mensaje propio responde en español; con mensaje propio lo conserva', () => {
    configureSpanishValidation();
    const issues = z
      .object({ id: z.string().uuid(), name: z.string() })
      .strict()
      .safeParse({ id: 'x', extra: 1 })
      .error!.issues.map((issue) => issue.message);
    expect(issues).toEqual([
      'El identificador no es válido.',
      'Falta un dato obligatorio.',
      'La solicitud incluye datos que no se pueden modificar.',
    ]);
    for (const message of issues) expect(message).not.toMatch(TECHNICAL);
    expect(
      z.string({ message: 'Ingresá una fecha válida.' }).safeParse(1).error!.issues[0]!.message,
    ).toBe('Ingresá una fecha válida.');
  });
});
