import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearAccessToken } from '../auth/accessTokenStore';
import { PERSON_A, PERSON_B, emptyHistory, listResponse, makeTask } from './fixtures/tasks';
import { categoriesResponse, itemsList, makeItem } from './fixtures/stock';

/**
 * Etapa 5P — presupuesto de navegación sobre la APP COMPLETA (`App`: mismos
 * providers, `BrowserRouter`, `AuthProvider` y `QueryClient` reales). Solo se
 * simula `fetch` con respuestas sintéticas de test y se registra cada
 * request: así se prueba lo que el usuario percibe (sin recargas, sin
 * re-bootstrap, datos cacheados al volver), no detalles internos.
 */

const ADMIN = { id: 'admin-sintetico', role: 'ADMIN', status: 'ACTIVE', employee: null };
const PERF = {
  range: {
    from: '2026-09-19',
    to: '2026-09-25',
    timeZone: 'America/Argentina/Buenos_Aires',
    includesCurrentDay: true,
    maxDays: 90,
  },
  team: {
    expected: 1,
    completed: 1,
    percentage: 100,
    performed: 1,
    coveredOthers: 0,
    receivedHelp: 0,
  },
  special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 0 },
  employees: [],
  trend: [],
};

function body(path: string): unknown {
  if (path.startsWith('/auth/refresh')) return { accessToken: 'token-sintetico', expiresIn: 900 };
  if (path.startsWith('/auth/me')) return { user: ADMIN };
  if (path.startsWith('/auth/login-options')) return { options: [] };
  if (path.startsWith('/tasks/employees')) return { employees: [PERSON_A, PERSON_B] };
  if (path.startsWith('/tasks/history')) return emptyHistory();
  if (path.startsWith('/tasks')) return listResponse([makeTask()]);
  if (path.startsWith('/performance')) return PERF;
  if (path.startsWith('/stock/categories')) return categoriesResponse();
  if (path.startsWith('/stock/items')) return itemsList([makeItem()]);
  if (path.startsWith('/admin/users'))
    return { users: [], pagination: { page: 1, pageSize: 50, total: 0 } };
  return {};
}

let calls: string[] = [];

function count(prefix: string): number {
  return calls.filter((call) => call.split(' ')[1]?.startsWith(prefix)).length;
}

/** GET del listado de tareas exactamente (sin confundirlo con /tasks/history o /tasks/employees). */
const taskListCalls = () => calls.filter((call) => /^GET \/tasks(\?|$)/.test(call)).length;

beforeEach(() => {
  calls = [];
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      return new Response(JSON.stringify(body(path)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearAccessToken();
});

const mainNav = () => screen.getByRole('navigation', { name: 'Navegación principal' });
const tasksNav = () => screen.getByRole('navigation', { name: 'Secciones de Tareas' });

async function bootToHome() {
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: /Hola/ });
}

describe('navegación SPA — la sesión se restaura una sola vez por documento', () => {
  it('Tareas ↔ Desempeño: sin re-bootstrap, sin refresh ni /me, shell montado', async () => {
    const user = userEvent.setup();
    await bootToHome();
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    const shellHeader = document.querySelector('.app-header');

    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });

    await user.click(within(tasksNav()).getByRole('link', { name: /Desempeño/ }));
    await screen.findByRole('heading', { level: 1, name: /Desempeño/ });
    expect(screen.queryByText(/Restaurando tu sesión/)).not.toBeInTheDocument();

    await user.click(within(tasksNav()).getByRole('link', { name: /Tareas/ }));
    await screen.findByRole('heading', { level: 1, name: /Tareas/ });

    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    // El shell (y con él AuthProvider) nunca se desmontó: es el MISMO nodo.
    expect(document.querySelector('.app-header')).toBe(shellHeader);
  });

  it('los links internos son navegación del router, nunca una carga de documento', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });

    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    // En burbujeo, después de que el router procesó el click.
    window.addEventListener('click', listener);
    await user.click(within(tasksNav()).getByRole('link', { name: /Desempeño/ }));
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await user.click(within(mainNav()).getByRole('link', { name: 'Inicio' }));
    window.removeEventListener('click', listener);

    expect(prevented).toEqual([true, true, true]);
  });

  it('volver a una pantalla visitada muestra sus datos al instante, sin requests nuevos', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);
    const before = calls.length;

    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    // Sincrónico: la lista ya está, sin loader de carga.
    expect(screen.getByRole('list', { name: 'Tareas del período' })).toBeInTheDocument();
    expect(screen.queryByText(/Cargando tareas/)).not.toBeInTheDocument();
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    expect(screen.getByText(makeItem().name)).toBeInTheDocument();
    expect(screen.queryByText(/Cargando inventario/)).not.toBeInTheDocument();

    expect(calls.length).toBe(before);
  });

  it('atrás/adelante del navegador conserva la sesión y la caché', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });
    await user.click(within(mainNav()).getByRole('link', { name: 'Inicio' }));
    await screen.findByRole('heading', { level: 1, name: /Hola/ });
    const before = calls.length;

    act(() => window.history.back());
    await screen.findByRole('list', { name: 'Tareas del período' });
    act(() => window.history.forward());
    await screen.findByRole('heading', { level: 1, name: /Hola/ });

    expect(calls.length).toBe(before);
    expect(count('/auth/refresh')).toBe(1);
  });

  it('el historial de la semana actual se pide una sola vez aunque lo usen dos componentes', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });
    await waitFor(() => expect(count('/tasks/history')).toBe(1));
    expect(taskListCalls()).toBe(1);
    expect(count('/tasks/employees')).toBe(1);
  });
});

describe('StrictMode no duplica requests operativos', () => {
  it('doble montaje de efectos: un solo refresh, un solo /me y un solo GET por recurso', async () => {
    window.history.replaceState(null, '', '/tasks');
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await screen.findByRole('list', { name: 'Tareas del período' });
    await waitFor(() => expect(count('/tasks/history')).toBeGreaterThan(0));
    expect(count('/tasks/history')).toBe(1);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(taskListCalls()).toBe(1);
    expect(count('/tasks/employees')).toBe(1);
  });
});

describe('logout — nada de la sesión sobrevive', () => {
  it('limpia la caché: un nuevo login vuelve a pedir los datos (no muestra los anteriores)', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
    await waitFor(() => expect(count('/auth/logout')).toBe(1));
    expect(screen.queryByRole('list', { name: 'Tareas del período' })).not.toBeInTheDocument();
    expect(screen.queryByText(makeTask().description)).not.toBeInTheDocument();
  });
});
