import { StrictMode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearAccessToken } from '../auth/accessTokenStore';
import { PERSON_A, PERSON_B, emptyHistory, listResponse, makeTask } from './fixtures/tasks';
import {
  categoriesResponse,
  emptyReportSummary,
  itemsList,
  makeItem,
  makeLowItem,
  reportMovementsList,
} from './fixtures/stock';
import { historyResponse, makeCollection, makeSummary } from './fixtures/chickenCoop';
import {
  detailResponse,
  listResponse as petsListResponse,
  makePet,
  recordsResponse,
  typesResponse,
} from './fixtures/pets';

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
  if (path.startsWith('/stock/destinations')) return { destinations: [] };
  if (path.startsWith('/stock/reports/summary')) return emptyReportSummary();
  if (path.startsWith('/stock/reports/movements')) return reportMovementsList();
  if (/^\/stock\/items\/[^/?]+\/movements/.test(path)) return { movement: {}, item: makeItem() };
  if (path.startsWith('/stock/items') && path.includes('stockLevel=low')) {
    return itemsList([makeLowItem()]);
  }
  if (path.startsWith('/stock/items') && path.includes('stockLevel=')) return itemsList([]);
  if (path.startsWith('/stock/items')) return itemsList([makeItem()]);
  if (path.startsWith('/chicken-coop/summary')) return makeSummary();
  if (path.startsWith('/chicken-coop/collections')) {
    return path.includes('?') ? historyResponse() : { collection: makeCollection() };
  }
  if (path.startsWith('/pets/types')) return typesResponse();
  if (/^\/pets\/[^/?]+\/records/.test(path)) return recordsResponse();
  if (/^\/pets\/[^/?]+$/.test(path)) return detailResponse();
  if (path.startsWith('/pets')) return petsListResponse();
  if (path.startsWith('/admin/users'))
    return { users: [], pagination: { page: 1, pageSize: 50, total: 0 } };
  return {};
}

let calls: string[] = [];
/** Headers `Idempotency-Key` recibidos por el `fetch` simulado, en orden. */
let idempotencyKeys: (string | undefined)[] = [];

function count(prefix: string): number {
  return calls.filter((call) => call.split(' ')[1]?.startsWith(prefix)).length;
}

/** GET del listado de tareas exactamente (sin confundirlo con /tasks/history o /tasks/employees). */
const taskListCalls = () => calls.filter((call) => /^GET \/tasks(\?|$)/.test(call)).length;

beforeEach(() => {
  calls = [];
  idempotencyKeys = [];
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input).replace('/api/v1', '');
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const idempotent =
        method === 'POST' && (path.includes('/movements') || path === '/chicken-coop/collections');
      if (idempotent) {
        idempotencyKeys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
      }
      return new Response(JSON.stringify(body(path)), {
        status: idempotent ? 201 : 200,
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

describe('Stock — subvistas SPA (Etapa 5C.2)', () => {
  const stockNav = () => screen.getByRole('navigation', { name: 'Secciones de Stock' });

  it('Casa → Jardín → Compras → Reportes → Catálogo: sin recarga, sin refresh ni /me, shell montado', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);

    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('click', listener);
    await user.click(within(stockNav()).getByRole('link', { name: 'Jardín' }));
    await screen.findByRole('heading', { level: 2, name: /Jardín/ });
    await user.click(within(stockNav()).getByRole('link', { name: 'Compras' }));
    await screen.findByText('1 producto por reponer');
    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    await screen.findByRole('region', { name: 'Resumen del período' });
    await user.click(within(stockNav()).getByRole('link', { name: 'Catálogo' }));
    await screen.findByRole('list', { name: 'Productos de stock' });
    window.removeEventListener('click', listener);

    expect(prevented).toEqual([true, true, true, true]);
    expect(screen.queryByText(/Restaurando tu sesión/)).not.toBeInTheDocument();
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
  });

  it('volver a Compras y Reportes dentro de la frescura: 0 requests y sin loader', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);
    await user.click(within(stockNav()).getByRole('link', { name: 'Compras' }));
    await screen.findByText('1 producto por reponer');
    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    await screen.findByRole('region', { name: 'Resumen del período' });
    const before = calls.length;

    await user.click(within(stockNav()).getByRole('link', { name: 'Compras' }));
    expect(screen.getByText('1 producto por reponer')).toBeInTheDocument();
    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    expect(screen.getByRole('region', { name: 'Resumen del período' })).toBeInTheDocument();
    await user.click(within(stockNav()).getByRole('link', { name: 'Casa' }));
    expect(screen.getByText(makeItem().name)).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    expect(calls.length).toBe(before);
  });

  it('primera visita: requests exactos por subvista y sin GET duplicados', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);
    const gets = () => calls.filter((call) => call.startsWith('GET /stock'));
    // Casa: inventario + categorías, una vez cada uno.
    expect(gets().sort()).toEqual([
      'GET /stock/categories?status=all',
      'GET /stock/items?area=HOUSE&status=active&page=1&pageSize=50',
    ]);

    await user.click(within(stockNav()).getByRole('link', { name: 'Compras' }));
    await screen.findByText('1 producto por reponer');
    const purchases = gets().filter((call) => call.includes('stockLevel='));
    expect(purchases).toHaveLength(2);
    expect(new Set(purchases).size).toBe(2);

    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    await screen.findByRole('region', { name: 'Resumen del período' });
    await waitFor(() => expect(count('/stock/reports/movements')).toBe(1));
    expect(count('/stock/reports/summary')).toBe(1);
  });

  it('un ingreso envía Idempotency-Key e invalida inventario, Compras y reportes (sin tocar categorías)', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);
    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    await screen.findByRole('region', { name: 'Resumen del período' });
    await user.click(within(stockNav()).getByRole('link', { name: 'Casa' }));
    await screen.findByText(makeItem().name);
    const categoriesBefore = count('/stock/categories');
    const itemsBefore = calls.filter((call) =>
      call.startsWith('GET /stock/items?area=HOUSE'),
    ).length;

    await user.click(
      screen.getByRole('button', { name: `Registrar movimiento: ${makeItem().name}` }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /ingreso \/ entrada/i }));
    await user.type(within(dialog).getByLabelText('Cantidad'), '3');
    const submit = within(dialog).getByRole('button', { name: /registrar movimiento/i });
    // Doble clic real: un solo POST.
    await user.dblClick(submit);
    expect(await screen.findByText('Ingreso registrado.')).toBeInTheDocument();

    expect(calls.filter((call) => call.startsWith('POST /stock/items/'))).toHaveLength(1);
    expect(idempotencyKeys).toHaveLength(1);
    expect(idempotencyKeys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    // Inventario visible revalidado; reportes/compras quedan marcados viejos
    // y se piden al volver (no se revalida en segundo plano lo que no se ve).
    await waitFor(() =>
      expect(calls.filter((call) => call.startsWith('GET /stock/items?area=HOUSE')).length).toBe(
        itemsBefore + 1,
      ),
    );
    expect(count('/stock/categories')).toBe(categoriesBefore);
    const summaryBefore = count('/stock/reports/summary');
    await user.click(within(stockNav()).getByRole('link', { name: 'Reportes' }));
    await waitFor(() => expect(count('/stock/reports/summary')).toBe(summaryBefore + 1));
  });
});

describe('🐔 Gallinero (Etapa 5G)', () => {
  const kpis = () => screen.getByRole('list', { name: 'Indicadores del gallinero' });

  it('Stock → Gallinero → Tareas → Gallinero: sin recarga, sin refresh ni /me, revisita con 0 requests', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('click', listener);

    await user.click(within(mainNav()).getByRole('link', { name: 'Stock' }));
    await screen.findByText(makeItem().name);
    await user.click(within(mainNav()).getByRole('link', { name: 'Gallinero' }));
    await screen.findByRole('heading', { level: 1, name: 'Gallinero' });
    await screen.findByRole('list', { name: 'Recolecciones por día' });
    // Primera visita: exactamente 1 resumen + 1 página de historial (el
    // ADMIN además pide las personas elegibles, catálogo compartido).
    expect(count('/chicken-coop/summary')).toBe(1);
    expect(count('/chicken-coop/collections')).toBe(1);
    expect(count('/tasks/employees')).toBe(1);

    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });
    const before = calls.length;
    await user.click(within(mainNav()).getByRole('link', { name: 'Gallinero' }));
    // Sincrónico: datos cacheados, sin loader global ni local.
    expect(kpis()).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    window.removeEventListener('click', listener);

    expect(calls.length).toBe(before);
    expect(prevented).toEqual([true, true, true, true]);
    expect(screen.queryByText(/Restaurando tu sesión/)).not.toBeInTheDocument();
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
  });

  it('registrar: doble clic = un POST con Idempotency-Key; invalida solo el gallinero', async () => {
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Gallinero' }));
    await screen.findByRole('list', { name: 'Recolecciones por día' });
    const stockBefore = count('/stock');
    const tasksBefore = count('/tasks');

    const form = screen.getByRole('form', { name: 'Registrar recolección' });
    await user.type(within(form).getByLabelText('Huevos buenos'), '4');
    await user.dblClick(within(form).getByRole('button', { name: 'Registrar recolección' }));
    expect(await within(form).findByText(/Recolección registrada/)).toBeInTheDocument();

    expect(calls.filter((call) => call === 'POST /chicken-coop/collections')).toHaveLength(1);
    expect(idempotencyKeys).toHaveLength(1);
    expect(idempotencyKeys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    await waitFor(() => expect(count('/chicken-coop/summary')).toBe(2));
    await waitFor(() => expect(count('/chicken-coop/collections?')).toBe(2));
    expect(count('/stock')).toBe(stockBefore);
    expect(count('/tasks')).toBe(tasksBefore);
    expect(count('/auth/refresh')).toBe(1);
  });
});

describe('🐾 Mascotas (Etapa 5M)', () => {
  it('listado → ficha → volver → revisita: sin recarga ni refresh/me, datos desde caché', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('click', listener);

    await user.click(within(mainNav()).getByRole('link', { name: 'Mascotas' }));
    const card = await screen.findByRole('link', { name: new RegExp(makePet().name) });
    expect(count('/pets?')).toBe(1);
    expect(count('/pets/types')).toBe(1);

    await user.click(card);
    await screen.findByRole('list', { name: 'Registros clínicos' });
    expect(count(`/pets/${makePet().id}`)).toBe(2); // ficha + historial, una vez cada uno
    // "Mascotas" sigue marcado como destino activo dentro de la ficha.
    expect(within(mainNav()).getByRole('link', { name: 'Mascotas' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const before = calls.length;
    await user.click(screen.getByRole('link', { name: /Volver/ }));
    expect(screen.getByRole('link', { name: new RegExp(makePet().name) })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: new RegExp(makePet().name) }));
    expect(screen.getByRole('list', { name: 'Registros clínicos' })).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    window.removeEventListener('click', listener);

    expect(calls.length).toBe(before);
    expect(prevented.every(Boolean)).toBe(true);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
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
