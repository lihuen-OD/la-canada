import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * `render` de tests con un `QueryClient` NUEVO por caso (Etapa 5P): ningún
 * test hereda caché de otro. Sin reintentos (un fallo simulado es
 * definitivo) y con la misma política de frescura que la app, para que los
 * tests reflejen el comportamiento real de caché/revalidación.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/**
 * `route`: envuelve en un `MemoryRouter` en esa ruta, para pantallas que usan
 * `Link`/`NavLink` y se testean sin el árbol de rutas completo. Los tests que
 * ya montan su propio router no lo pasan (no se anidan routers).
 */
export function render(
  ui: ReactElement,
  options: RenderOptions & { queryClient?: QueryClient; route?: string } = {},
) {
  const { queryClient = createTestQueryClient(), route, ...rest } = options;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {route ? <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter> : children}
    </QueryClientProvider>
  );
  return { queryClient, ...rtlRender(ui, { wrapper: Wrapper, ...rest }) };
}

// Utilidad solo de tests (nunca se sirve con Fast Refresh): reexporta Testing Library.
// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';
