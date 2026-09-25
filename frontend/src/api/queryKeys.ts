import type { ChickenCoopPeriodDays } from './chickenCoopTypes';
import type { MedicalRecordType } from './petTypes';
import type {
  ListStockItemsParams,
  StockCategoryStatusFilter,
  StockDestinationStatusFilter,
  StockMovementType,
  StockReportFilters,
} from './stockTypes';

/**
 * Claves de caché — única fuente de verdad (Etapa 5P). TODAS empiezan con
 * `['session', userId]`: la caché de una persona nunca puede servir datos a
 * otra aunque, por un error, no se vaciara al cambiar de sesión (igual se
 * vacía: `AuthProvider`). Las invalidaciones se hacen por prefijo de dominio
 * (`queryKeys.tasks.all(userId)`), nunca con un `invalidateQueries()` global.
 */
const scope = (userId: string) => ['session', userId] as const;

export const queryKeys = {
  tasks: {
    all: (userId: string) => [...scope(userId), 'tasks'] as const,
    list: (userId: string, status: 'active' | 'all') =>
      [...scope(userId), 'tasks', 'list', status] as const,
    employees: (userId: string) => [...scope(userId), 'tasks', 'employees'] as const,
    history: (userId: string, week: string | null, employeeId: string | null) =>
      [...scope(userId), 'tasks', 'history', week ?? 'current', employeeId ?? 'all'] as const,
  },
  performance: {
    all: (userId: string) => [...scope(userId), 'performance'] as const,
    summary: (userId: string, from: string, to: string) =>
      [...scope(userId), 'performance', 'summary', from, to] as const,
    employee: (userId: string, employeeId: string, from: string, to: string) =>
      [...scope(userId), 'performance', 'employee', employeeId, from, to] as const,
  },
  stock: {
    all: (userId: string) => [...scope(userId), 'stock'] as const,
    /**
     * Listados de productos: inventario Casa/Jardín, Compras (`stockLevel` +
     * `sort=name`) y catálogo comparten esta familia — un movimiento o un
     * cambio de catálogo invalida `itemsAll` y todas se revalidan.
     */
    items: (userId: string, filters: Omit<ListStockItemsParams, 'page' | 'pageSize'>) =>
      [...scope(userId), 'stock', 'items', filters] as const,
    itemsAll: (userId: string) => [...scope(userId), 'stock', 'items'] as const,
    /** Detalle de un producto (fuera de `items` para no confundirlo con un listado). */
    item: (userId: string, itemId: string) => [...scope(userId), 'stock', 'item', itemId] as const,
    itemAll: (userId: string) => [...scope(userId), 'stock', 'item'] as const,
    categories: (userId: string, status: StockCategoryStatusFilter) =>
      [...scope(userId), 'stock', 'categories', status] as const,
    categoriesAll: (userId: string) => [...scope(userId), 'stock', 'categories'] as const,
    destinations: (userId: string, status: StockDestinationStatusFilter) =>
      [...scope(userId), 'stock', 'destinations', status] as const,
    destinationsAll: (userId: string) => [...scope(userId), 'stock', 'destinations'] as const,
    /** Historial de UN producto; el prefijo sin filtro invalida todos sus filtros. */
    movements: (userId: string, itemId: string, type?: StockMovementType | '') =>
      type === undefined
        ? ([...scope(userId), 'stock', 'movements', itemId] as const)
        : ([...scope(userId), 'stock', 'movements', itemId, type || 'all'] as const),
    movementsAll: (userId: string) => [...scope(userId), 'stock', 'movements'] as const,
    reportSummary: (userId: string, filters: StockReportFilters) =>
      [...scope(userId), 'stock', 'reports', 'summary', filters] as const,
    reportMovements: (userId: string, filters: StockReportFilters) =>
      [...scope(userId), 'stock', 'reports', 'movements', filters] as const,
    reportsAll: (userId: string) => [...scope(userId), 'stock', 'reports'] as const,
  },
  chickenCoop: {
    /** Todo el gallinero: una recolección, anulación o cambio de gallinas invalida la familia entera. */
    all: (userId: string) => [...scope(userId), 'chickenCoop'] as const,
    /** KPIs + análisis del período (los KPIs de promedio/postura dependen del período). */
    summary: (userId: string, days: ChickenCoopPeriodDays) =>
      [...scope(userId), 'chickenCoop', 'summary', days] as const,
    /** Historial paginado por días (`useInfiniteQuery`). */
    history: (userId: string) => [...scope(userId), 'chickenCoop', 'history'] as const,
  },
  pets: {
    /** Toda la familia de Mascotas (listados, fichas, historiales y tipos). */
    all: (userId: string) => [...scope(userId), 'pets'] as const,
    /** Catálogo de tipos (5 min): `active` para formularios/chips, `all` para el ADMIN. */
    types: (userId: string, status: 'active' | 'all') =>
      [...scope(userId), 'pets', 'types', status] as const,
    typesAll: (userId: string) => [...scope(userId), 'pets', 'types'] as const,
    /** Listado paginado (`useInfiniteQuery`) por filtro de tipo. */
    list: (userId: string, typeId: string | null) =>
      [...scope(userId), 'pets', 'list', typeId ?? 'all'] as const,
    listAll: (userId: string) => [...scope(userId), 'pets', 'list'] as const,
    /** Ficha + KPIs de UNA mascota. */
    detail: (userId: string, petId: string) => [...scope(userId), 'pets', 'detail', petId] as const,
    /** Historial clínico de UNA mascota; el prefijo sin tipo invalida todos sus filtros. */
    records: (userId: string, petId: string, type?: MedicalRecordType | 'all') =>
      type === undefined
        ? ([...scope(userId), 'pets', 'records', petId] as const)
        : ([...scope(userId), 'pets', 'records', petId, type] as const),
    /** Imagen por id de archivo: inmutable (una foto nueva es otro id). */
    photo: (userId: string, fileId: string) => [...scope(userId), 'pets', 'photo', fileId] as const,
  },
  admin: {
    users: (userId: string) => [...scope(userId), 'admin', 'users'] as const,
  },
};
