import type { ListStockItemsParams, StockCategoryStatusFilter } from './stockTypes';

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
    items: (userId: string, filters: Omit<ListStockItemsParams, 'page' | 'pageSize'>) =>
      [...scope(userId), 'stock', 'items', filters] as const,
    itemsAll: (userId: string) => [...scope(userId), 'stock', 'items'] as const,
    categories: (userId: string, status: StockCategoryStatusFilter) =>
      [...scope(userId), 'stock', 'categories', status] as const,
    categoriesAll: (userId: string) => [...scope(userId), 'stock', 'categories'] as const,
    destinations: (userId: string) => [...scope(userId), 'stock', 'destinations'] as const,
    movements: (userId: string, itemId: string) =>
      [...scope(userId), 'stock', 'movements', itemId] as const,
    movementsAll: (userId: string) => [...scope(userId), 'stock', 'movements'] as const,
  },
  admin: {
    users: (userId: string) => [...scope(userId), 'admin', 'users'] as const,
  },
};
