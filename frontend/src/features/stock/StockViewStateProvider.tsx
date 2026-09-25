import { useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { INITIAL_STOCK_VIEW_STATE, StockViewContext, type StockViewState } from './stockViewState';

/** Estado de filtros de las subvistas de Stock (solo memoria, ver `stockViewState.ts`). */
export function StockViewStateProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<StockViewState>(INITIAL_STOCK_VIEW_STATE);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <StockViewContext.Provider value={value}>{children}</StockViewContext.Provider>;
}
