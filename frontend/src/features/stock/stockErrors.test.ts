import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/httpClient';
import { errorMessageOf, NETWORK_ERROR_MESSAGE } from './stockErrors';

describe('errores humanos de Stock', () => {
  it('distingue los dos conflictos de saldo 409', () => {
    expect(
      errorMessageOf(
        new ApiError(409, 'detalle variable del backend', 'STOCK_INSUFFICIENT_QUANTITY'),
      ),
    ).toBe('La reducción supera el stock disponible.');
    expect(
      errorMessageOf(new ApiError(409, 'detalle variable del backend', 'STOCK_BALANCE_LIMIT')),
    ).toBe('El incremento superaría el saldo máximo permitido.');
  });

  it.each([
    ['STOCK_CATEGORY_IN_USE', 'La categoría tiene productos activos y no se puede desactivar.'],
    ['STOCK_ITEM_NOT_FOUND', 'El producto ya no existe.'],
    ['STOCK_CATEGORY_NOT_FOUND', 'La categoría ya no existe.'],
    ['STOCK_DESTINATION_NOT_FOUND', 'El destino ya no existe.'],
    ['STOCK_ITEM_INACTIVE', 'El producto está desactivado.'],
    ['STOCK_CATEGORY_INACTIVE', 'La categoría está inactiva.'],
    ['STOCK_DESTINATION_INACTIVE', 'El destino está inactivo.'],
  ])('%s tiene un mensaje estable y humano', (code, expected) => {
    expect(
      errorMessageOf(new ApiError(code.endsWith('NOT_FOUND') ? 404 : 409, 'interno', code)),
    ).toBe(expected);
  });

  it('conserva validaciones humanas del backend y oculta errores de red crudos', () => {
    expect(errorMessageOf(new ApiError(400, 'La fecha no es válida.', 'VALIDATION_ERROR'))).toBe(
      'La fecha no es válida.',
    );
    expect(errorMessageOf(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE);
  });
});
