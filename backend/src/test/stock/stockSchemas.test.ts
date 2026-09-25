import { describe, expect, it } from 'vitest';
import {
  createStockCategoryBodySchema,
  createStockDestinationBodySchema,
  createStockItemBodySchema,
  createStockMovementBodySchema,
  idempotencyKeySchema,
  listStockDestinationsQuerySchema,
  listStockItemsQuerySchema,
  listStockMovementsQuerySchema,
  stockMinimumQuantityTextSchema,
  stockQuantityTextSchema,
  updateStockCategoryBodySchema,
  updateStockDestinationBodySchema,
  updateStockItemBodySchema,
} from '../../stock/stockSchemas';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const DESTINATION_ID = '22222222-2222-4222-8222-222222222222';

describe('stockQuantityTextSchema — decimal estricto como texto', () => {
  it.each(['2', '2.5', '2.50', '0.01', '0.10', '99999999.99', '12345678'])('acepta %s', (value) => {
    expect(stockQuantityTextSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['0', 'cero'],
    ['0.00', 'cero con decimales'],
    ['00', 'ceros iniciales'],
    ['01', 'cero inicial ambiguo'],
    ['00.50', 'ceros iniciales ambiguos con decimales'],
    ['-1', 'negativa'],
    ['1.234', 'tres decimales'],
    ['123456789', '9 dígitos enteros'],
    ['abc', 'texto'],
    ['NaN', 'NaN textual'],
    ['Infinity', 'Infinity textual'],
    ['1e2', 'notación exponencial'],
    ['', 'vacía'],
    [' 2 ', 'con espacios'],
    ['2.', 'punto final sin decimales'],
  ])('rechaza %s (%s)', (value) => {
    expect(stockQuantityTextSchema.safeParse(value).success).toBe(false);
  });

  it('rechaza un number de JavaScript (nunca float)', () => {
    expect(stockQuantityTextSchema.safeParse(2).success).toBe(false);
    expect(stockQuantityTextSchema.safeParse(1.5).success).toBe(false);
  });
});

describe('stockMinimumQuantityTextSchema — umbral decimal no negativo', () => {
  it.each(['0', '0.0', '0.00', '0.01', '2.50', '99999999.99'])(
    'acepta %s, incluido mínimo cero documentado',
    (value) => {
      expect(stockMinimumQuantityTextSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(['00', '01', '-1', '1.234', '123456789', 'NaN', 'Infinity', '1e2', ' 0 '])(
    'rechaza %s',
    (value) => {
      expect(stockMinimumQuantityTextSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('createStockItemBodySchema', () => {
  const valid = {
    name: 'Detergente nuevo',
    area: 'HOUSE',
    categoryId: CATEGORY_ID,
    unit: 'litros',
    minimumQuantity: '3',
  };

  it('acepta un producto válido de área HOUSE', () => {
    expect(createStockItemBodySchema.safeParse(valid).success).toBe(true);
  });

  it('acepta mínimo 0 porque es un umbral válido, no un movimiento', () => {
    expect(createStockItemBodySchema.safeParse({ ...valid, minimumQuantity: '0' }).success).toBe(
      true,
    );
  });

  it('rechaza area BOTH en un producto (es solo para categorías)', () => {
    expect(createStockItemBodySchema.safeParse({ ...valid, area: 'BOTH' }).success).toBe(false);
  });

  it('rechaza currentQuantity en el body: las cantidades no se setean al crear', () => {
    expect(createStockItemBodySchema.safeParse({ ...valid, currentQuantity: '10' }).success).toBe(
      false,
    );
  });

  it('rechaza campos desconocidos (.strict)', () => {
    expect(createStockItemBodySchema.safeParse({ ...valid, active: false }).success).toBe(false);
  });
});

describe('updateStockItemBodySchema — inmutabilidad del saldo', () => {
  it('rechaza currentQuantity (solo cambia vía movimientos)', () => {
    expect(updateStockItemBodySchema.safeParse({ currentQuantity: '99' }).success).toBe(false);
  });

  it('rechaza area (inmutable)', () => {
    expect(updateStockItemBodySchema.safeParse({ area: 'GARDEN' }).success).toBe(false);
  });

  it('rechaza active (usa el endpoint /status)', () => {
    expect(updateStockItemBodySchema.safeParse({ active: false }).success).toBe(false);
  });

  it('rechaza un body sin cambios', () => {
    expect(updateStockItemBodySchema.safeParse({}).success).toBe(false);
  });

  it('acepta cambios válidos de nombre/unidad/mínimo/categoría', () => {
    expect(
      updateStockItemBodySchema.safeParse({
        name: 'Detergente 2L',
        unit: 'litros',
        minimumQuantity: '4.5',
        categoryId: CATEGORY_ID,
      }).success,
    ).toBe(true);
  });
});

describe('createStockMovementBodySchema', () => {
  const base = { quantity: '2.5', type: 'CONSUMPTION' };

  it('acepta consumo con destino', () => {
    expect(
      createStockMovementBodySchema.safeParse({ ...base, destinationId: DESTINATION_ID }).success,
    ).toBe(true);
  });

  it('acepta ingreso, consumo y ajustes', () => {
    for (const type of ['INCOME', 'CONSUMPTION', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE']) {
      expect(createStockMovementBodySchema.safeParse({ type, quantity: '1' }).success).toBe(true);
    }
  });

  it('rechaza OPENING_BALANCE: el saldo inicial lo carga solo el seed', () => {
    expect(
      createStockMovementBodySchema.safeParse({ type: 'OPENING_BALANCE', quantity: '1' }).success,
    ).toBe(false);
  });

  it('rechaza destino en un ingreso (solo aplica a consumos)', () => {
    expect(
      createStockMovementBodySchema.safeParse({
        type: 'INCOME',
        quantity: '1',
        destinationId: DESTINATION_ID,
      }).success,
    ).toBe(false);
  });

  it('rechaza destino en un ajuste', () => {
    expect(
      createStockMovementBodySchema.safeParse({
        type: 'ADJUSTMENT_DECREASE',
        quantity: '1',
        destinationId: DESTINATION_ID,
      }).success,
    ).toBe(false);
  });

  it('rechaza campos desconocidos (.strict)', () => {
    for (const field of ['employeeId', 'stockItemId', 'currentQuantity', 'area', 'active']) {
      expect(
        createStockMovementBodySchema.safeParse({ ...base, [field]: DESTINATION_ID }).success,
      ).toBe(false);
    }
  });

  it('rechaza una fecha con formato inválido', () => {
    expect(
      createStockMovementBodySchema.safeParse({ ...base, effectiveDate: 'ayer' }).success,
    ).toBe(false);
  });
});

describe('createStockCategoryBodySchema / updateStockCategoryBodySchema', () => {
  it('acepta BOTH para categorías', () => {
    expect(
      createStockCategoryBodySchema.safeParse({ name: 'Alimentos', area: 'BOTH' }).success,
    ).toBe(true);
  });

  it('colapsa espacios del nombre', () => {
    const parsed = createStockCategoryBodySchema.safeParse({
      name: '  Limpieza   varias  ',
      area: 'HOUSE',
    });
    expect(parsed.success && parsed.data.name).toBe('Limpieza varias');
  });

  it('el update no permite cambiar area', () => {
    expect(updateStockCategoryBodySchema.safeParse({ area: 'GARDEN' }).success).toBe(false);
  });
});

describe('listStockItemsQuerySchema', () => {
  it('aplica defaults: status active, page 1, pageSize 50', () => {
    const parsed = listStockItemsQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual({
      status: 'active',
      page: 1,
      pageSize: 50,
    });
  });

  it('coercea page/pageSize desde query string', () => {
    const parsed = listStockItemsQuerySchema.safeParse({ page: '2', pageSize: '10' });
    expect(parsed.success && parsed.data.page).toBe(2);
    expect(parsed.success && parsed.data.pageSize).toBe(10);
  });

  it('rechaza pageSize > 100 y filtros desconocidos', () => {
    expect(listStockItemsQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(listStockItemsQuerySchema.safeParse({ orden: 'nombre' }).success).toBe(false);
  });
});

describe('listStockMovementsQuerySchema', () => {
  it('permite filtrar por cualquier tipo del enum (incluye OPENING_BALANCE del historial)', () => {
    expect(listStockMovementsQuerySchema.safeParse({ type: 'OPENING_BALANCE' }).success).toBe(true);
  });

  it('rechaza un tipo fuera del enum', () => {
    expect(listStockMovementsQuerySchema.safeParse({ type: 'OTRO' }).success).toBe(false);
  });
});

describe('listStockItemsQuerySchema — filtro stockLevel', () => {
  it.each(['ok', 'low', 'critical'])('acepta stockLevel=%s', (level) => {
    expect(listStockItemsQuerySchema.safeParse({ stockLevel: level }).success).toBe(true);
  });

  it.each(['crit', 'OK', 'low ', ''])('rechaza stockLevel=%s', (level) => {
    expect(listStockItemsQuerySchema.safeParse({ stockLevel: level }).success).toBe(false);
  });
});

describe('listStockDestinationsQuerySchema', () => {
  it('por defecto lista solo activos', () => {
    const parsed = listStockDestinationsQuerySchema.safeParse({});
    expect(parsed.success && parsed.data).toEqual({ status: 'active' });
  });

  it('acepta status=all (lectura de inactivos, restringida a ADMIN en el service)', () => {
    expect(listStockDestinationsQuerySchema.safeParse({ status: 'all' }).success).toBe(true);
  });

  it('rechaza otros estados y filtros desconocidos', () => {
    expect(listStockDestinationsQuerySchema.safeParse({ status: 'inactive' }).success).toBe(false);
    expect(listStockDestinationsQuerySchema.safeParse({ orden: 'nombre' }).success).toBe(false);
  });
});

describe('createStockDestinationBodySchema / updateStockDestinationBodySchema', () => {
  it('acepta un destino válido VEHICLE/SECTOR', () => {
    expect(
      createStockDestinationBodySchema.safeParse({ name: 'Atajo', type: 'SECTOR' }).success,
    ).toBe(true);
    expect(
      createStockDestinationBodySchema.safeParse({ name: 'Camioneta', type: 'VEHICLE' }).success,
    ).toBe(true);
  });

  it('colapsa espacios del nombre como el resto del módulo', () => {
    const parsed = createStockDestinationBodySchema.safeParse({
      name: '  Atajo   del   fondo  ',
      type: 'SECTOR',
    });
    expect(parsed.success && parsed.data.name).toBe('Atajo del fondo');
  });

  it('rechaza tipo fuera del enum, campos desconocidos y nombre muy corto', () => {
    expect(
      createStockDestinationBodySchema.safeParse({ name: 'Atajo', type: 'TRUCK' }).success,
    ).toBe(false);
    expect(
      createStockDestinationBodySchema.safeParse({ name: 'Atajo', type: 'SECTOR', active: true })
        .success,
    ).toBe(false);
    expect(createStockDestinationBodySchema.safeParse({ name: 'A', type: 'SECTOR' }).success).toBe(
      false,
    );
  });

  it('el update admite nombre, estado o ambos; vacío se rechaza', () => {
    expect(updateStockDestinationBodySchema.safeParse({ name: 'Nuevo nombre' }).success).toBe(true);
    expect(updateStockDestinationBodySchema.safeParse({ active: false }).success).toBe(true);
    expect(
      updateStockDestinationBodySchema.safeParse({ name: 'Nuevo', active: false }).success,
    ).toBe(true);
    expect(updateStockDestinationBodySchema.safeParse({}).success).toBe(false);
  });

  it('el update no permite cambiar type (inmutable) ni campos desconocidos', () => {
    expect(updateStockDestinationBodySchema.safeParse({ type: 'SECTOR' }).success).toBe(false);
    expect(updateStockDestinationBodySchema.safeParse({ name: 'X', otro: 1 }).success).toBe(false);
    expect(
      updateStockDestinationBodySchema.safeParse({
        name: 'Destino válido',
        active: false,
        type: 'VEHICLE',
        id: '11111111-1111-4111-8111-111111111111',
        movements: [],
      }).success,
    ).toBe(false);
  });
});

describe('idempotencyKeySchema — formato del header (Etapa 5C.1)', () => {
  it.each([
    ['abcdefgh', 'mínimo 8 caracteres'],
    ['A1_b2-C3_d4', 'letras, números, guion bajo y guion'],
    ['f47ac10b-58cc-4372-a567-0e02b2c3d479', 'uuid de 36 caracteres'],
    ['x'.repeat(64), 'máximo 64 caracteres'],
  ])('acepta %s (%s)', (value) => {
    expect(idempotencyKeySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['abcdefg', '7 caracteres'],
    ['x'.repeat(65), '65 caracteres'],
    ['con espacio', 'espacio'],
    ['con:dos_puntos', 'dos puntos'],
    ['con/slash', 'slash'],
    ['', 'vacía'],
  ])('rechaza %s (%s)', (value) => {
    expect(idempotencyKeySchema.safeParse(value).success).toBe(false);
  });
});

describe('createStockMovementBodySchema — opcionales canónicos para idempotencia', () => {
  it('omitido y undefined se eliminan del body validado', () => {
    expect(
      createStockMovementBodySchema.parse({
        type: 'INCOME',
        quantity: '1',
        effectiveDate: undefined,
        destinationId: undefined,
        reason: undefined,
      }),
    ).toEqual({
      type: 'INCOME',
      quantity: '1',
      effectiveDate: undefined,
      destinationId: undefined,
      reason: undefined,
    });
  });

  it.each([
    { effectiveDate: null },
    { effectiveDate: '' },
    { destinationId: null },
    { destinationId: '' },
    { reason: null },
    { reason: '' },
  ])('rechaza null o string vacío en opcionales: %o', (optional) => {
    expect(
      createStockMovementBodySchema.safeParse({
        type: 'CONSUMPTION',
        quantity: '1',
        ...optional,
      }).success,
    ).toBe(false);
  });
});
