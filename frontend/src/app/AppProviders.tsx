import type { PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthProvider';

/**
 * Composición de providers a nivel aplicación. `AuthProvider` adentro de
 * `BrowserRouter` a propósito: no necesita el router para nada, pero así
 * queda disponible para cualquier futuro hook de navegación sin invertir
 * el orden después.
 */
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );
}
