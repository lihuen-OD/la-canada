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
  makeCritItem,
  reportMovementsList,
} from './fixtures/stock';
import { historyResponse, makeCollection, makeSummary } from './fixtures/chickenCoop';
import {
  detailResponse,
  listResponse as petsListResponse,
  makePet,
  recordsResponse,
  typesResponse,
  dueResponse,
} from './fixtures/pets';
import {
  eventsResponse,
  gardenResponse,
  newsResponse,
  photoFolder,
  photoFoldersResponse,
  photosResponse,
  summaryResponse,
} from './fixtures/more';

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
    assigned: 1,
    completedPersonally: 1,
    percentage: 100,
    pending: 0,
    coverageReceived: 0,
    coverageGiven: 0,
    operationalCompleted: 1,
  },
  special: { urgentCompleted: 0, oneTimeCompleted: 0, urgentPending: 0 },
  employees: [],
  trend: [],
};

function body(path: string): unknown {
  if (path.startsWith('/auth/refresh')) return { accessToken: 'token-sintetico', expiresIn: 900 };
  if (path.startsWith('/auth/me')) return { user: ADMIN };
  if (path.startsWith('/auth/login-options')) return { options: [] };
  if (path.startsWith('/dashboard'))
    return {
      // Mismo día y hora de servidor que el listado de tareas sintético
      // (un backend real informa un solo día; ver docs/ARCHITECTURE.md §39.1).
      generatedAt: '2026-09-24T15:00:00.000Z',
      today: '2026-09-24',
      timeZone: 'America/Argentina/Cordoba',
      kpis: {
        tasksCompleted: 0,
        tasksTotal: 0,
        urgentPending: 0,
        stockAlerts: 0,
        goodEggsToday: 0,
      },
      urgentTasks: [],
      performance: null,
      stockAlerts: [],
      upcomingEvents: [],
      petDue: { counts: { overdue: 0, dueToday: 0, upcoming: 0 }, items: [] },
      latestNews: [],
    };
  if (path.startsWith('/tasks/employees')) return { employees: [PERSON_A, PERSON_B] };
  if (path.startsWith('/participants')) {
    return {
      participants: [
        { kind: 'ADMIN', id: ADMIN.id, displayName: 'Administrador', colorHex: null },
        { kind: 'EMPLOYEE', ...PERSON_A },
        { kind: 'EMPLOYEE', ...PERSON_B },
      ],
    };
  }
  if (path.startsWith('/tasks/history')) return emptyHistory();
  if (path.startsWith('/tasks')) return listResponse([makeTask()]);
  if (path.startsWith('/performance')) return performanceBody;
  if (path.startsWith('/stock/categories')) return categoriesResponse();
  if (path.startsWith('/stock/destinations')) return { destinations: [] };
  if (path.startsWith('/stock/reports/summary')) return emptyReportSummary();
  if (path.startsWith('/stock/reports/movements')) return reportMovementsList();
  if (/^\/stock\/items\/[^/?]+\/movements/.test(path)) return { movement: {}, item: makeItem() };
  if (path.startsWith('/stock/items') && path.includes('stockLevel=critical')) {
    return itemsList([makeCritItem()]);
  }
  if (path.startsWith('/stock/items') && path.includes('stockLevel=')) return itemsList([]);
  if (path.startsWith('/stock/items')) return itemsList([makeItem()]);
  if (path.startsWith('/chicken-coop/summary')) return makeSummary();
  if (path.startsWith('/chicken-coop/collections')) {
    return path.includes('?') ? historyResponse() : { collection: makeCollection() };
  }
  if (path.startsWith('/pets/types')) return typesResponse();
  if (path.startsWith('/pets/due')) return dueResponse();
  if (/^\/pets\/[^/?]+\/records/.test(path)) return recordsResponse();
  if (/^\/pets\/[^/?]+$/.test(path)) return detailResponse();
  if (path.startsWith('/pets')) return petsListResponse();
  if (path.startsWith('/more/summary')) return summaryResponse();
  if (/^\/more\/garden\/versions\/[^/?]+\/content/.test(path)) {
    return new Blob(['plano-sintetico'], { type: 'image/jpeg' });
  }
  if (path.startsWith('/more/garden/versions')) return gardenResponse();
  if (path.startsWith('/photos/folders')) {
    return photoFoldersResponse([photoFolder('carpeta-sintetica', 'Carpeta sintética')]);
  }
  if (/^\/photos\/[^/?]+\/content/.test(path)) {
    return new Blob(['foto-sintetica'], { type: 'image/jpeg' });
  }
  if (path.startsWith('/photos')) return photosResponse();
  if (path.startsWith('/news')) return newsResponse();
  if (path.startsWith('/events')) return eventsResponse();
  if (path.startsWith('/admin/users'))
    return { users: [], pagination: { page: 1, pageSize: 50, total: 0 } };
  return {};
}

/** Respuesta de Desempeño (resumen y detalle); un caso la cambia para tener filas con acciones. */
let performanceBody: unknown = PERF;

let calls: string[] = [];
/** Headers `Idempotency-Key` recibidos por el `fetch` simulado, en orden. */
let idempotencyKeys: (string | undefined)[] = [];

function count(prefix: string): number {
  return calls.filter((call) => call.split(' ')[1]?.startsWith(prefix)).length;
}

/** GET del listado de tareas exactamente (sin confundirlo con /tasks/history o /tasks/employees). */
const taskListCalls = () => calls.filter((call) => /^GET \/tasks(\?|$)/.test(call)).length;

/** GET del historial de planos exactamente (sin confundirlo con `/versions/:id/content`). */
const gardenListCalls = () =>
  calls.filter((call) => /^GET \/more\/garden\/versions(\?|$)/.test(call));
/** GET del binario de un plano. */
const gardenContentCalls = () =>
  calls.filter((call) => /^GET \/more\/garden\/versions\/[^/?]+\/content/.test(call));

beforeEach(() => {
  calls = [];
  idempotencyKeys = [];
  performanceBody = PERF;
  window.history.replaceState(null, '', '/');
  // jsdom no implementa object URLs: sin esto la descarga del binario (fotos,
  // planos) fallaría y el query quedaría en error, que SI se reintenta al
  // volver a montar — y el test mediría un reintento, no la caché.
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => `blob:${blob.size}`),
      revokeObjectURL: vi.fn(),
    }),
  );
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
  await screen.findByRole('heading', { level: 1, name: /Buenos días/ });
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
    await screen.findByRole('heading', { level: 1, name: /Buenos días/ });
    const before = calls.length;

    act(() => window.history.back());
    await screen.findByRole('list', { name: 'Tareas del período' });
    act(() => window.history.forward());
    await screen.findByRole('heading', { level: 1, name: /Buenos días/ });

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
    // Compras: una consulta por nivel (críticos y bajos), sin duplicados.
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
    // ADMIN además pide las personas elegibles — empleados y administradores —,
    // catálogo compartido con Stock).
    expect(count('/chicken-coop/summary')).toBe(1);
    expect(count('/chicken-coop/collections')).toBe(1);
    expect(count('/participants')).toBe(1);

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
    expect(count('/pets/due')).toBe(1); // «Próximas atenciones» de la ficha
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

describe('☰ Más (Etapa 5X)', () => {
  it('grilla → Novedades → volver → Eventos → volver → revisita: SPA, sin refresh/me, datos desde caché', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('click', listener);

    await user.click(within(mainNav()).getByRole('link', { name: 'Más' }));
    await screen.findByText('2 hoy');
    expect(count('/more/summary')).toBe(1);

    await user.click(screen.getByRole('link', { name: /Novedades/ }));
    await screen.findByText('Aviso sintético 0');
    expect(count('/news')).toBe(1);
    await user.click(screen.getByRole('link', { name: /Volver/ }));
    await user.click(screen.getByRole('link', { name: /Eventos/ }));
    await screen.findByText('Visita sintética');
    expect(count('/events')).toBe(1);
    expect(within(mainNav()).getByRole('link', { name: 'Más' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const before = calls.length;
    await user.click(screen.getByRole('link', { name: /Volver/ }));
    await user.click(screen.getByRole('link', { name: /Novedades/ }));
    expect(screen.getByText('Aviso sintético 0')).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    window.removeEventListener('click', listener);

    expect(calls.length).toBe(before);
    expect(prevented.every(Boolean)).toBe(true);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
  });
});

describe('\u{1F333} Jardín (Etapa 5Y)', () => {
  it('Más → Jardín → visor → volver → revisita: SPA, sin refresh/me, datos desde caché', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    // Solo los clicks en links: cada uno debe ser navegación del router
    // (defaultPrevented), nunca una carga de documento.
    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('a'))
        prevented.push(event.defaultPrevented);
    };
    window.addEventListener('click', listener);

    await user.click(within(mainNav()).getByRole('link', { name: 'Más' }));
    await screen.findByRole('link', { name: /Jardín/ });
    await user.click(screen.getByRole('link', { name: /Jardín/ }));
    const current = await screen.findByRole('region', { name: 'Plano vigente' });
    expect(within(current).getByText('Vigente')).toBeInTheDocument();
    // Una sola request del historial; el binario se pide una vez por version.
    // Una sola request del historial; y UN request por versión: la miniatura del
    // historial y el visor comparten la misma entrada de caché (aquí el binario
    // de cada versión se pide una vez, no dos).
    expect(gardenListCalls().length).toBe(1);
    expect(gardenContentCalls().filter((call) => call.includes('garden-2')).length).toBe(1);
    expect(gardenContentCalls().filter((call) => call.includes('garden-1')).length).toBe(1);

    await user.click(within(current).getByRole('button', { name: /Ver la versión 2/ }));
    await screen.findByRole('dialog');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }));
    await user.click(screen.getByRole('link', { name: /Volver/ }));
    await screen.findByRole('link', { name: /Jardín/ });
    await user.click(screen.getByRole('link', { name: /Jardín/ }));
    expect(screen.getByRole('region', { name: 'Plano vigente' })).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    window.removeEventListener('click', listener);

    // Volver no pide ni el historial ni ningún binario otra vez.
    expect(gardenListCalls().length).toBe(1);
    expect(gardenContentCalls().length).toBe(2);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
    expect(prevented.every(Boolean)).toBe(true);
  });
});

describe('📸 Fotos y carpetas — navegación', () => {
  it('Más → Fotos → carpeta → Fotos → Todas las fotos → revisita: SPA, sin refresh/me, carpetas una vez', async () => {
    const user = userEvent.setup();
    await bootToHome();
    const shellHeader = document.querySelector('.app-header');
    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest('a'))
        prevented.push(event.defaultPrevented);
    };
    window.addEventListener('click', listener);
    const folderCalls = () => calls.filter((call) => /^GET \/photos\/folders/.test(call));
    const photoListCalls = (scope: string) =>
      calls.filter((call) => /^GET \/photos\?/.test(call) && call.includes(scope));

    await user.click(within(mainNav()).getByRole('link', { name: 'Más' }));
    await user.click(await screen.findByRole('link', { name: /Fotos/ }));
    const folderLink = await screen.findByRole('link', { name: /Carpeta sintética/ });
    await user.click(folderLink);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Carpeta sintética' }),
    ).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Ver Foto sintética' });
    await user.click(screen.getByRole('link', { name: /Fotos/ }));
    await user.click(await screen.findByRole('link', { name: /Todas las fotos/ }));
    await screen.findByRole('button', { name: 'Ver Foto sintética' });
    await user.click(screen.getByRole('link', { name: /Fotos/ }));
    await user.click(await screen.findByRole('link', { name: /Carpeta sintética/ }));
    expect(screen.getByRole('button', { name: 'Ver Foto sintética' })).toBeInTheDocument();
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument();
    window.removeEventListener('click', listener);

    // Un listado de carpetas para todo el recorrido (pantalla, encabezado y
    // selectores) y una página por vista; la revisita sale de la caché.
    expect(folderCalls().length).toBe(1);
    expect(photoListCalls('folder=carpeta-sintetica').length).toBe(1);
    expect(calls.filter((call) => /^GET \/photos\?/.test(call)).length).toBe(2);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
    expect(document.querySelector('.app-header')).toBe(shellHeader);
    expect(prevented.every(Boolean)).toBe(true);
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

describe('Desempeño → Detalle: carga olvidada y enlace a Tareas sin reiniciar la sesión', () => {
  it('registrar una obligación pasada revalida Desempeño y Tareas; «Completar en Tareas» es navegación SPA', async () => {
    const person = { ...PERSON_A, role: 'Doméstica' };
    const row = {
      description: 'Tarea sintética olvidada',
      frequency: 'DAILY',
      status: 'pending',
      periodKey: '2026-09-23',
      assignedEmployeeId: PERSON_A.id,
      completed: false,
      completedByEmployeeId: null,
      assignedEmployee: person,
      completedByEmployee: null,
      completedAt: null,
    };
    performanceBody = {
      ...PERF,
      employees: [{ employee: person, ...PERF.team }],
      occurrences: [
        {
          ...row,
          taskId: 't-olvidada',
          lateCompletion: {
            periodStart: '2026-09-23',
            periodEnd: '2026-09-23',
            earliest: '2026-09-23',
            latest: '2026-09-23',
          },
        },
        {
          ...row,
          taskId: 't-una-vez',
          description: 'Tarea sintética una vez',
          frequency: 'ONE_TIME',
          periodKey: 'ONE_TIME',
          completeInTasks: true,
        },
      ],
    };
    const user = userEvent.setup();
    await bootToHome();
    await user.click(within(mainNav()).getByRole('link', { name: 'Tareas' }));
    await screen.findByRole('list', { name: 'Tareas del período' });
    await user.click(within(tasksNav()).getByRole('link', { name: /Desempeño/ }));
    await user.click(await screen.findByRole('button', { name: /Persona sintética A/ }));
    await user.click(await screen.findByRole('button', { name: /Marcar realizada/ }));
    const dialog = await screen.findByRole('dialog');
    // ADMIN: elige explícitamente quién la realizó.
    await user.click(await within(dialog).findByRole('radio', { name: /Persona sintética A/ }));
    const detailsBefore = count('/performance/employees/');
    const listsBefore = taskListCalls();
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(calls.filter((call) => /^POST \/tasks/.test(call))).toEqual([
      'POST /tasks/t-olvidada/late-completion',
    ]);
    // Revalida el detalle visible (invalidación de Desempeño); el listado de Tareas,
    // que no está en pantalla, queda marcado para la próxima visita.
    await waitFor(() => expect(count('/performance/employees/')).toBeGreaterThan(detailsBefore));
    expect(taskListCalls()).toBe(listsBefore);

    const prevented: boolean[] = [];
    const listener = (event: MouseEvent) => prevented.push(event.defaultPrevented);
    window.addEventListener('click', listener);
    await user.click(screen.getByRole('link', { name: /Completar en Tareas/ }));
    window.removeEventListener('click', listener);
    await screen.findByRole('list', { name: 'Tareas del período' });
    expect(prevented).toEqual([true]);
    // Al volver, Tareas se revalida una vez (estaba invalidada) sin reiniciar la sesión.
    await waitFor(() => expect(taskListCalls()).toBe(listsBefore + 1));
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
  });
});
