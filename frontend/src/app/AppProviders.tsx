import type { PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Composición de providers a nivel aplicación. Hoy solo envuelve el router;
 * es el lugar natural para sumar providers futuros (auth, datos, etc.) sin
 * tocar App.tsx.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return <BrowserRouter>{children}</BrowserRouter>;
}
