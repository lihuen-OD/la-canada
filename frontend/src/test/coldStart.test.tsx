import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { clearAccessToken } from '../auth/accessTokenStore';
import { resetBackendAvailability } from '../connectivity/backendAvailability';
import { emptyHistory, listResponse, makeTask } from './fixtures/tasks';

/**
 * Etapa 5R — arranque en frío sobre la APP COMPLETA (mismos providers,
 * router, `AuthProvider` y `QueryClient` reales). Solo se simula `fetch`:
 * `GET /health` responde 503 (Render despertando) tantas veces como indique
 * la cola, y los tiempos se controlan con timers falsos. No hace falta
 * apagar Render ni esperar un cold start real.
 */

type Reply = number | 'network' | 'hang' | { status: number; body: unknown };

const ADMIN = { id: 'admin-sintetico', role: 'ADMIN', status: 'ACTIVE', employee: null };
const DASHBOARD = {
  generatedAt: '2026-09-25T12:00:00.000Z',
  today: '2026-09-25',
  timeZone: 'America/Argentina/Cordoba',
  kpis: { tasksCompleted: 0, tasksTotal: 0, urgentPending: 0, stockAlerts: 0, goodEggsToday: 0 },
  urgentTasks: [],
  performance: null,
  stockAlerts: [],
  upcomingEvents: [],
  latestNews: [],
};

function defaultBody(p: string): unknown {
  if (p.startsWith('/health')) return { status: 'ok' };
  if (p.startsWith('/auth/refresh')) return { accessToken: 'token-sintetico', expiresIn: 900 };
  if (p.startsWith('/auth/me')) return { user: ADMIN };
  if (p.startsWith('/auth/login-options')) return { options: [] };
  if (p.startsWith('/dashboard')) return DASHBOARD;
  if (p.startsWith('/tasks/employees')) return { employees: [] };
  if (p.startsWith('/tasks/history')) return emptyHistory();
  if (p.startsWith('/tasks')) return listResponse([makeTask()]);
  return {};
}

let calls: string[] = [];
/** Body JSON de cada request, en el mismo orden que `calls`. */
let bodies: unknown[] = [];
/** Cola de respuestas por prefijo de ruta; la última se repite. Sin cola: 200 con el cuerpo por defecto. */
let queues: Record<string, Reply[]> = {};

function respond(p: string, init?: RequestInit): Promise<Response> {
  const key = Object.keys(queues).find((prefix) => p.startsWith(prefix));
  const queue = key ? queues[key]! : [];
  const next: Reply = queue.length > 1 ? queue.shift()! : (queue[0] ?? 200);
  if (next === 'network') return Promise.reject(new TypeError('Failed to fetch'));
  if (next === 'hang') {
    return new Promise((_, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
    );
  }
  if (typeof next === 'number') {
    if (next >= 400) return Promise.resolve(new Response('<html>Proxy</html>', { status: next }));
    return Promise.resolve(Response.json(defaultBody(p), { status: next }));
  }
  return Promise.resolve(Response.json(next.body, { status: next.status }));
}

/** `attemptId` de cada `POST /auth/refresh`, en orden. */
const refreshAttempts = () =>
  calls
    .map((call, index) => (call === 'POST /auth/refresh' ? bodies[index] : null))
    .filter(Boolean)
    .map((body) => (body as { attemptId: string }).attemptId);

const count = (prefix: string) =>
  calls.filter((call) => call.split(' ')[1]?.startsWith(prefix)).length;

/**
 * Avanza el reloj falso y después vacía varias vueltas: cada `fetch`
 * simulado encadena lecturas de cuerpo asíncronas (health → refresh → me →
 * dashboard) que necesitan más de un tick para asentarse.
 */
async function advance(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  for (let index = 0; index < 20; index += 1) {
    await act(() => vi.advanceTimersByTimeAsync(0));
  }
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const wakeHeading = () => screen.queryByRole('heading', { name: /Preparando La Cañada/ });
const home = () => screen.queryByRole('heading', { level: 1, name: /Buenos días/ });
const loginSelector = () => screen.queryByText(/Elegí tu identidad/);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  calls = [];
  bodies = [];
  queues = {};
  // Arranque real: nadie comprobó todavía el backend.
  resetBackendAvailability();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const p = String(input).replace('/api/v1', '');
      calls.push(`${init?.method ?? 'GET'} ${p}`);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return respond(p, init);
    }),
  );
});

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAccessToken();
});

describe('arranque en frío — carga inicial', () => {
  it('backend rápido: sin cartel, sin retraso y health → refresh → me en ese orden, sin duplicados', async () => {
    render(<App />);
    await advance(0);
    expect(home()).toBeInTheDocument();
    await advance(3000);
    expect(wakeHeading()).not.toBeInTheDocument();
    expect(calls.slice(0, 3)).toEqual(['GET /health', 'POST /auth/refresh', 'GET /auth/me']);
    // Antes de la etapa: refresh + me + dashboard (3). Ahora: + un health (4).
    expect(calls).toEqual(['GET /health', 'POST /auth/refresh', 'GET /auth/me', 'GET /dashboard']);
  });

  it('StrictMode: un solo health, un refresh y un /me', async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await advance(0);
    expect(home()).toBeInTheDocument();
    expect(count('/health')).toBe(1);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/me')).toBe(1);
  });

  it('backend dormido: el cartel aparece recién después del umbral, nunca el login', async () => {
    queues['/health'] = ['hang'];
    render(<App />);
    await advance(1000);
    expect(wakeHeading()).not.toBeInTheDocument();
    expect(screen.getByText(/Restaurando tu sesión/)).toBeInTheDocument();

    await advance(1000);
    expect(wakeHeading()).toBeInTheDocument();
    expect(
      screen.getByText(/Estamos iniciando el servidor y recuperando tu información/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reintentando automáticamente/)).toBeInTheDocument();
    expect(screen.getByText(/Esperando hace 2 s/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar ahora' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/%/);
    expect(loginSelector()).not.toBeInTheDocument();
    // El refresh todavía no se envió: primero tiene que despertar el backend.
    expect(count('/auth/refresh')).toBe(0);
  });

  it('recuperación automática: 503 varias veces y luego 200 → continúa sola hasta Inicio', async () => {
    queues['/health'] = [503, 503, 503, 200];
    render(<App />);
    await advance(2000);
    expect(wakeHeading()).toBeInTheDocument();
    expect(screen.getByText(/Próximo intento en/)).toBeInTheDocument();

    await advance(2000 + 4000 + 8000);
    expect(home()).toBeInTheDocument();
    expect(wakeHeading()).not.toBeInTheDocument();
    expect(count('/health')).toBe(4);
    expect(count('/auth/refresh')).toBe(1);
    expect(loginSelector()).not.toBeInTheDocument();
  });

  it('más de 60 s: reconoce la demora sin afirmar que el servidor está caído', async () => {
    queues['/health'] = [503];
    render(<App />);
    await advance(62_000);
    expect(
      screen.getByText(
        'El servidor está tardando más de lo habitual. Podés seguir esperando o reintentar ahora.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Esperando hace 1 min 02 s/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/caído|no funciona|unos minutos/i);
    // Backoff con tope: 2+4+8 y luego cada 10 s → ~8 intentos en un minuto.
    expect(count('/health')).toBeLessThanOrEqual(9);
  });

  it('"Reintentar ahora" ejecuta un único intento inmediato', async () => {
    queues['/health'] = [503, 200];
    render(<App />);
    await advance(1600);
    expect(wakeHeading()).toBeInTheDocument();
    expect(count('/health')).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar ahora' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar ahora' }));
    expect(count('/health')).toBe(2);
    await advance(0);
    expect(home()).toBeInTheDocument();
  });

  it('sin Internet: avisa, no sondea, y al volver la conexión reanuda', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    render(<App />);
    await advance(0);
    expect(screen.getByText(/Sin conexión a Internet\. Volveremos a intentar/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar ahora' })).not.toBeInTheDocument();
    await advance(60_000);
    expect(calls).toEqual([]);

    setOnline(true);
    await advance(0);
    expect(home()).toBeInTheDocument();
  });

  it('pestaña oculta: 0 sondeo; al volver a verse, reanuda', async () => {
    queues['/health'] = [503, 200];
    render(<App />);
    await advance(0);
    setVisibility('hidden');
    await advance(120_000);
    expect(count('/health')).toBe(1);

    setVisibility('visible');
    await advance(0);
    expect(count('/health')).toBe(2);
    expect(home()).toBeInTheDocument();
  });

  it('el aviso usa aria-live: solo el mensaje se anuncia, no el contador', async () => {
    queues['/health'] = ['hang'];
    render(<App />);
    await advance(2000);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent(/Estamos iniciando el servidor/);
    expect(live).not.toHaveTextContent(/Esperando hace/);
  });

  it('401 al restaurar (sesión vencida) → selector de ingreso', async () => {
    queues['/auth/refresh'] = [
      { status: 401, body: { error: { message: 'x', code: 'AUTH_SESSION_INVALID' } } },
    ];
    render(<App />);
    await advance(0);
    expect(loginSelector()).toBeInTheDocument();
  });

  it('refresh sin respuesta: no se repite solo ni hace logout; "Reintentar" reenvía el MISMO intento', async () => {
    queues['/auth/refresh'] = ['network', 200];
    render(<App />);
    await advance(0);
    expect(screen.getByText('No pudimos confirmar tu sesión.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a ingresar' })).toBeInTheDocument();
    await advance(60_000);
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/auth/logout')).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await advance(0);
    expect(home()).toBeInTheDocument();
    const attempts = refreshAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toBe(attempts[0]);
  });

  it('refresh sin respuesta y "Volver a ingresar": logout con el intento en duda, sin otro refresh', async () => {
    queues['/auth/refresh'] = ['network'];
    render(<App />);
    await advance(0);
    fireEvent.click(screen.getByRole('button', { name: 'Volver a ingresar' }));
    await advance(0);
    expect(loginSelector()).toBeInTheDocument();
    expect(count('/auth/logout')).toBe(1);
    expect(count('/auth/refresh')).toBe(1);
    const logoutBody = bodies[calls.indexOf('POST /auth/logout')] as { attemptId?: string };
    expect(logoutBody.attemptId).toBe(refreshAttempts()[0]);
  });

  it('un 5xx del backend al restaurar: error temporal reintentable, sin decir que está despertando', async () => {
    queues['/auth/refresh'] = [
      { status: 503, body: { error: { message: 'x', code: 'AUTH_REFRESH_UNAVAILABLE' } } },
      200,
    ];
    render(<App />);
    await advance(0);
    expect(screen.getByText(/No pudimos conectarnos con el servidor/)).toBeInTheDocument();
    expect(wakeHeading()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await advance(0);
    expect(home()).toBeInTheDocument();
    expect(count('/auth/refresh')).toBe(2);
  });
});

describe('login con el backend dormido', () => {
  it('las identidades se cargan solas cuando despierta, con "Preparando La Cañada" en la tarjeta', async () => {
    queues['/auth/refresh'] = [{ status: 401, body: { error: { message: 'x' } } }];
    queues['/health'] = [200, 503, 503, 200];
    queues['/auth/login-options'] = [
      503,
      {
        status: 200,
        body: { options: [{ id: 'u1', displayName: 'Coke', role: 'EMPLOYEE', colorHex: null }] },
      },
    ];
    render(<App />);
    await advance(0);
    const card = screen.getByRole('region', { name: 'Ingreso' });
    await advance(2000);
    expect(within(card).getByRole('heading', { name: /Preparando La Cañada/ })).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/No pudimos cargar/);

    await advance(4500);
    expect(within(card).getByRole('button', { name: /Coke/ })).toBeInTheDocument();
    expect(count('/auth/login-options')).toBe(2);
  });
});

describe('app abierta con datos cacheados', () => {
  it('conserva shell y datos, muestra un banner discreto, se recupera sola y confirma la reconexión', async () => {
    render(<App />);
    await advance(0);
    expect(home()).toBeInTheDocument();
    const shellHeader = document.querySelector('.app-header');
    const healthBefore = count('/health');

    // Datos vencidos (staleTime 30 s) y Render se durmió.
    await advance(31_000);
    queues['/dashboard'] = [503, 200];
    queues['/health'] = [503, 503, 200];
    fireEvent.click(screen.getByRole('link', { name: 'Tareas' }));
    await advance(0);
    fireEvent.click(screen.getByRole('link', { name: 'Inicio' }));
    await advance(2000);

    expect(home()).toBeInTheDocument();
    expect(
      screen.getByText('Reconectando con el servidor… Tus datos siguen visibles.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Restaurando tu sesión/)).not.toBeInTheDocument();
    expect(wakeHeading()).not.toBeInTheDocument();
    expect(document.querySelector('.app-header')).toBe(shellHeader);

    await advance(2000 + 4000);
    expect(screen.getByText('Conexión restablecida.')).toBeInTheDocument();
    expect(home()).toBeInTheDocument();
    expect(count('/health') - healthBefore).toBe(3);
    expect(count('/auth/refresh')).toBe(1);

    await advance(4000);
    expect(screen.queryByText('Conexión restablecida.')).not.toBeInTheDocument();

    // Navegación posterior: cero health checks.
    const healthAfter = count('/health');
    fireEvent.click(screen.getByRole('link', { name: 'Tareas' }));
    await advance(0);
    fireEvent.click(screen.getByRole('link', { name: 'Inicio' }));
    await advance(0);
    expect(count('/health')).toBe(healthAfter);
  });

  it('sin Internet: banner offline, datos visibles, sin cerrar sesión ni sondear', async () => {
    render(<App />);
    await advance(0);
    const before = calls.length;
    setOnline(false);
    await advance(0);
    expect(screen.getByText(/Sin conexión a Internet\./)).toBeInTheDocument();
    expect(
      screen.getByText(/Cuando vuelva la conexión, intentaremos actualizar automáticamente/),
    ).toBeInTheDocument();
    expect(home()).toBeInTheDocument();
    await advance(120_000);
    expect(calls.length).toBe(before);

    setOnline(true);
    await advance(0);
    expect(screen.getByText('Conexión restablecida.')).toBeInTheDocument();
    expect(count('/auth/logout')).toBe(0);
  });

  it('un 401 en uso con refresh sin respuesta: aviso para volver a ingresar, datos visibles, sin logout solo', async () => {
    render(<App />);
    await advance(0);
    await advance(31_000);
    queues['/dashboard'] = [
      { status: 401, body: { error: { message: 'x', code: 'AUTH_TOKEN_EXPIRED' } } },
    ];
    queues['/auth/refresh'] = ['network'];
    fireEvent.click(screen.getByRole('link', { name: 'Tareas' }));
    await advance(0);
    fireEvent.click(screen.getByRole('link', { name: 'Inicio' }));
    await advance(0);

    expect(screen.getByRole('alert')).toHaveTextContent(/No pudimos confirmar tu sesión/);
    expect(home()).toBeInTheDocument();
    await advance(60_000);
    expect(count('/auth/refresh')).toBe(2); // bootstrap + el único intento en uso
    expect(count('/auth/logout')).toBe(0);

    // "Reintentar" del aviso: reenvía el MISMO intento y la pantalla se recupera sola.
    queues['/auth/refresh'] = [200];
    queues['/dashboard'] = [200];
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
    await advance(0);
    const attempts = refreshAttempts();
    expect(attempts).toHaveLength(3);
    expect(attempts[2]).toBe(attempts[1]);
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect(home()).toBeInTheDocument();
  });
});

describe('movimiento reducido', () => {
  it('los estilos de conectividad no agregan animaciones; el spinner queda estático con reduced motion', () => {
    const stylesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles');
    const connectivity = readFileSync(path.join(stylesDir, 'connectivity.css'), 'utf8');
    const base = readFileSync(path.join(stylesDir, 'base.css'), 'utf8');
    expect(connectivity).not.toMatch(/animation|transition|@keyframes/);
    expect(base).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/);
  });
});
