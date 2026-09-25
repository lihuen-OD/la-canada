import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateStockCategoryRequest,
  CreateStockItemRequest,
  CreateStockMovementRequest,
} from './stockTypes';

const { apiRequestMock } = vi.hoisted(() => ({ apiRequestMock: vi.fn() }));
vi.mock('./httpClient', () => ({ apiRequest: apiRequestMock }));

import {
  createStockCategory,
  createStockDestination,
  createStockItem,
  createStockMovement,
  fetchStockCategories,
  fetchStockDestinations,
  fetchStockItem,
  fetchStockItemMovements,
  fetchStockItems,
  fetchStockReportMovements,
  fetchStockReportCsv,
  fetchStockReportSummary,
  setStockItemActive,
  updateStockCategory,
  updateStockDestination,
  updateStockItem,
} from './stockApi';

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockResolvedValue({});
});

describe('stockApi — rutas y verbos del contrato 5A', () => {
  it('GET /stock/items con query server-side', async () => {
    await fetchStockItems({
      q: 'abono',
      area: 'HOUSE',
      categoryId: 'c1',
      status: 'active',
      page: 2,
      pageSize: 50,
    });
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/stock/items?q=abono&area=HOUSE&categoryId=c1&status=active&page=2&pageSize=50',
      { authenticated: true },
    );
  });

  it('omite parámetros vacíos/undefined de la query', async () => {
    await fetchStockItems({ q: '', categoryId: undefined, area: 'GARDEN' });
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items?area=GARDEN', {
      authenticated: true,
    });
  });

  it('GET /stock/categories?status=', async () => {
    await fetchStockCategories('all');
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/categories?status=all', {
      authenticated: true,
    });
    await fetchStockCategories();
    expect(apiRequestMock).toHaveBeenLastCalledWith('/stock/categories?status=active', {
      authenticated: true,
    });
  });

  it('GET /stock/destinations, /items/:id y /items/:id/movements', async () => {
    await fetchStockDestinations();
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/destinations?status=active', {
      authenticated: true,
    });
    await fetchStockDestinations('all');
    expect(apiRequestMock).toHaveBeenLastCalledWith('/stock/destinations?status=all', {
      authenticated: true,
    });

    await fetchStockItem('i1');
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items/i1', { authenticated: true });

    await fetchStockItemMovements('i1', { type: 'INCOME', page: 1, pageSize: 20 });
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/stock/items/i1/movements?type=INCOME&page=1&pageSize=20',
      { authenticated: true },
    );
  });

  it('POST/PATCH del catálogo', async () => {
    const categoryBody: CreateStockCategoryRequest = { name: 'Nueva', area: 'BOTH' };
    await createStockCategory(categoryBody);
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/categories', {
      method: 'POST',
      body: categoryBody,
      authenticated: true,
    });

    await updateStockCategory('c1', { active: false });
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/categories/c1', {
      method: 'PATCH',
      body: { active: false },
      authenticated: true,
    });

    const itemBody: CreateStockItemRequest = {
      name: ' Producto ',
      area: 'HOUSE',
      categoryId: 'c1',
      unit: 'kg',
      minimumQuantity: '5',
    };
    await createStockItem(itemBody);
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items', {
      method: 'POST',
      body: itemBody,
      authenticated: true,
    });

    await updateStockItem('i1', { name: 'Otro' });
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items/i1', {
      method: 'PATCH',
      body: { name: 'Otro' },
      authenticated: true,
    });

    await setStockItemActive('i1', false);
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items/i1/status', {
      method: 'PATCH',
      body: { active: false },
      authenticated: true,
    });
  });

  it('POST de movimiento: Idempotency-Key solo como header, nunca en el body', async () => {
    const body: CreateStockMovementRequest = { type: 'INCOME', quantity: '5' };
    await createStockMovement('i1', body, 'clave-sintetica-0001');
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/items/i1/movements', {
      method: 'POST',
      body,
      authenticated: true,
      headers: { 'Idempotency-Key': 'clave-sintetica-0001' },
    });
    expect(JSON.stringify(body)).not.toMatch(/employeeId|stockItemId|idempotency/i);
  });

  it('destinos: POST/PATCH sin `type` en la edición (inmutable)', async () => {
    await createStockDestination({ name: 'Destino', type: 'SECTOR' });
    expect(apiRequestMock).toHaveBeenCalledWith('/stock/destinations', {
      method: 'POST',
      body: { name: 'Destino', type: 'SECTOR' },
      authenticated: true,
    });
    await updateStockDestination('d1', { active: false });
    expect(apiRequestMock).toHaveBeenLastCalledWith('/stock/destinations/d1', {
      method: 'PATCH',
      body: { active: false },
      authenticated: true,
    });
  });

  it('reportes: GET con filtros server-side, sin headers de idempotencia', async () => {
    await fetchStockReportSummary({ from: '2026-09-01', to: '2026-09-25', area: 'HOUSE' });
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/stock/reports/summary?from=2026-09-01&to=2026-09-25&area=HOUSE',
      { authenticated: true },
    );
    await fetchStockReportMovements({
      from: '2026-09-01',
      to: '2026-09-25',
      type: 'CONSUMPTION',
      page: 2,
      pageSize: 20,
    });
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      '/stock/reports/movements?from=2026-09-01&to=2026-09-25&type=CONSUMPTION&page=2&pageSize=20',
      { authenticated: true },
    );
    await fetchStockReportCsv({ from: '2026-09-01', to: '2026-09-25' });
    expect(apiRequestMock).toHaveBeenLastCalledWith(
      '/stock/reports/movements.csv?from=2026-09-01&to=2026-09-25',
      { authenticated: true, responseType: 'text' },
    );
  });

  it('listado con nivel y orden server-side (Compras)', async () => {
    await fetchStockItems({ status: 'active', stockLevel: 'critical', sort: 'name' });
    expect(apiRequestMock).toHaveBeenCalledWith(
      '/stock/items?status=active&stockLevel=critical&sort=name',
      { authenticated: true },
    );
  });
});
