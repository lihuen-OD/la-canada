import { createContext, useCallback, useContext, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  StockItemArea,
  StockLevel,
  StockMovementType,
  StockStatusFilter,
} from '../../api/stockTypes';

/**
 * Filtros de las subvistas de Stock, vivos mientras el módulo esté montado
 * (Etapa 5C.2): pasar de Casa a Compras y volver conserva la búsqueda y la
 * categoría de cada vista. Solo memoria de React — nunca storage — y se
 * pierden al salir de Stock o cerrar sesión.
 */

export interface InventoryFilters {
  q: string;
  categoryId: string;
  status: StockStatusFilter;
  stockLevel: StockLevel | '';
}

export type PurchaseLevelFilter = 'all' | 'critical' | 'low';
export type AreaFilter = 'all' | StockItemArea;

export interface PurchaseFilters {
  level: PurchaseLevelFilter;
  area: AreaFilter;
  categoryId: string;
  q: string;
}

export type ReportPeriod = '7' | '30' | '90' | '365' | 'custom';

export interface ReportFilterState {
  period: ReportPeriod;
  from: string;
  to: string;
  area: AreaFilter;
  categoryId: string;
  type: StockMovementType | '';
  itemId: string;
  employeeId: string;
  destinationId: string;
}

export interface StockViewState {
  inventory: Record<StockItemArea, InventoryFilters>;
  purchases: PurchaseFilters;
  reports: ReportFilterState | null;
}

const EMPTY_INVENTORY: InventoryFilters = {
  q: '',
  categoryId: '',
  status: 'active',
  stockLevel: '',
};

export const INITIAL_STOCK_VIEW_STATE: StockViewState = {
  inventory: { HOUSE: EMPTY_INVENTORY, GARDEN: EMPTY_INVENTORY },
  purchases: { level: 'all', area: 'all', categoryId: '', q: '' },
  reports: null,
};

export interface StockViewContextValue {
  state: StockViewState;
  setState: Dispatch<SetStateAction<StockViewState>>;
}

export const StockViewContext = createContext<StockViewContextValue | null>(null);

function useStockViewContext(): StockViewContextValue {
  const context = useContext(StockViewContext);
  if (!context) throw new Error('useStockViewState requiere <StockViewStateProvider>.');
  return context;
}

export function useInventoryFilters(
  area: StockItemArea,
): [InventoryFilters, (patch: Partial<InventoryFilters>) => void] {
  const { state, setState } = useStockViewContext();
  const update = useCallback(
    (patch: Partial<InventoryFilters>) =>
      setState((previous) => ({
        ...previous,
        inventory: { ...previous.inventory, [area]: { ...previous.inventory[area], ...patch } },
      })),
    [area, setState],
  );
  return [state.inventory[area], update];
}

export function usePurchaseFilters(): [PurchaseFilters, (patch: Partial<PurchaseFilters>) => void] {
  const { state, setState } = useStockViewContext();
  const update = useCallback(
    (patch: Partial<PurchaseFilters>) =>
      setState((previous) => ({ ...previous, purchases: { ...previous.purchases, ...patch } })),
    [setState],
  );
  return [state.purchases, update];
}

export function useReportFilters(
  initial: () => ReportFilterState,
): [ReportFilterState, (patch: Partial<ReportFilterState>) => void] {
  const { state, setState } = useStockViewContext();
  // El período inicial depende de "hoy": se calcula una sola vez por montaje del módulo.
  const [fallback] = useState(initial);
  const current = state.reports ?? fallback;
  const update = useCallback(
    (patch: Partial<ReportFilterState>) =>
      setState((previous) => ({
        ...previous,
        reports: { ...(previous.reports ?? fallback), ...patch },
      })),
    [setState, fallback],
  );
  return [current, update];
}
