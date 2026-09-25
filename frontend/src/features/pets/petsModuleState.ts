import { createContext, useContext } from 'react';

/**
 * Estado de navegación del módulo (Etapa 5M): el filtro por tipo del
 * listado se conserva al entrar a una ficha y volver ("← Volver"), mientras
 * el módulo esté montado. Solo memoria, nunca storage.
 */
export interface PetsModuleState {
  typeFilter: string | null;
  setTypeFilter: (typeId: string | null) => void;
}

export const PetsModuleContext = createContext<PetsModuleState | null>(null);

export function usePetsModuleState(): PetsModuleState {
  const state = useContext(PetsModuleContext);
  if (!state) throw new Error('usePetsModuleState fuera de PetsModule.');
  return state;
}
