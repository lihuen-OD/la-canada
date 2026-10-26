import { useSyncExternalStore } from 'react';
import { getBusinessToday, subscribeToBusinessDay } from './businessDay';

/** Fecha de negocio vigente (`YYYY-MM-DD`); el componente se vuelve a dibujar cuando empieza otro día. */
export function useBusinessToday(): string {
  return useSyncExternalStore(subscribeToBusinessDay, getBusinessToday);
}
