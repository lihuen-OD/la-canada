import { useState } from 'react';
import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createAppQueryClient } from '../api/queryClient';
import { AuthProvider } from '../auth/AuthProvider';

/**
 * Composición de providers a nivel aplicación — se montan UNA sola vez por
 * documento y nunca dependen de la ruta: navegar entre pantallas jamás
 * desmonta `AuthProvider` ni vacía la caché (Etapa 5P).
 *
 * `QueryClientProvider` va por fuera de `AuthProvider` porque este último
 * vacía la caché en cada cambio de sesión (login, logout, sesión perdida):
 * los datos de una persona nunca sobreviven a su sesión.
 */
export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>{children}</AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
