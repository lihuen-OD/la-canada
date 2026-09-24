import { describe, expect, it } from 'vitest';
import {
  createStockCategoryBodySchema,
  createStockItemBodySchema,
  createStockMovementBodySchema,
  listStockItemsQuerySchema,
  listStockMovementsQuerySchema,
  stockMinimumQuantityTextSchema,
  stockQuantityTextSchema,
  updateStockCategoryBodySchema,
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
