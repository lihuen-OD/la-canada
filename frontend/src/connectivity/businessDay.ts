import { BUSINESS_TIME_ZONE } from '../utils/dateFormat';

/**
 * Reloj del día de negocio en el navegador — ver docs/ARCHITECTURE.md §39.1.
 *
 * Una pantalla que queda abierta a medianoche tiene que pasar sola al día
 * nuevo, y con él a la semana, quincena, mes, bimestre o año nuevos: todos
 * esos límites caen en una medianoche de `BUSINESS_TIME_ZONE`. Este módulo
 * es la ÚNICA pieza que la vigila:
 *
 * - estado a nivel de módulo, como `backendAvailability`: StrictMode, los
 *   cambios de ruta y los componentes que lo leen no lo reinician ni lo
 *   duplican;
 * - **el backend es la autoridad del día**: `today` solo avanza cuando una
 *   respuesta (Tareas, Inicio o Desempeño) informa la fecha nueva
 *   (`reportServerDay`). El temporizador no cambia el día: a la medianoche
 *   pide confirmación (`subscribeToDayCheck`) y, si el backend todavía
 *   responde con el día anterior (dispositivo adelantado), se queda en ese
 *   día y vuelve a preguntar más tarde;
 * - la medianoche se calcula con la HORA DEL SERVIDOR cuando alguna respuesta
 *   la trae (`generatedAt`): el desfase con el reloj del dispositivo se
 *   descuenta, así que un dispositivo adelantado o atrasado no adelanta ni
 *   atrasa el cambio. La latencia de la respuesta solo puede demorarlo
 *   (nunca adelantarlo). Sin hora del servidor, se usa el reloj del
 *   dispositivo y, si el backend sigue en el día anterior, se reintenta con
 *   esperas crecientes y acotadas (`CONFIRMATION_RETRY_MS`);
 * - UN solo temporizador para toda la app; sin sondeo permanente ni requests
 *   propios: la confirmación la traen las mismas consultas que hay que
 *   revalidar (`BusinessDayRefresh`);
 * - al volver a la pestaña y al recuperar la conexión vuelve a mirar el
 *   reloj (con la pestaña oculta o el equipo suspendido, un temporizador se
 *   demora);
 * - el día sale de `Intl` en la zona de negocio, nunca de la zona del
 *   navegador. Antes de la primera respuesta del backend, el día es el del
 *   reloj (corregido) del dispositivo.
 */

/** Margen después de la medianoche del servidor antes de pedir confirmación. */
export const DAY_CHANGE_MARGIN_MS = 1_000;
/**
 * Esperas entre confirmaciones cuando el backend sigue en el día anterior y
 * no informó su hora. Se agotan y el reloj espera a la próxima respuesta, a
 * que vuelva la pestaña o la conexión: nunca hay sondeo permanente.
 */
export const CONFIRMATION_RETRY_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partsOf(instant: number) {
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de negocio (`YYYY-MM-DD`) de un instante. */
export function businessDateOf(instant: number): string {
  const { year, month, day } = partsOf(instant);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Primer instante (ms) del día de negocio `YYYY-MM-DD` — respeta cambios de horario si los hubiera. */
export function startOfBusinessDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day);
  const offsetAt = (instant: number) => {
    const parts = partsOf(instant);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  const firstOffset = offsetAt(guess);
  let result = guess - firstOffset;
  const secondOffset = offsetAt(result);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return result;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

interface ClockState {
  /** Día que usa la interfaz. */
  today: string;
  /** Algún dato del backend ya informó el día (desde entonces solo avanza con él). */
  confirmed: boolean;
  /** Hora del servidor − hora del dispositivo, estimada con la última respuesta que la trajo. */
  offsetMs: number;
  /** Se pidió confirmación de un día nuevo que el backend todavía no informó. */
  pending: boolean;
  /** Reintentos de confirmación ya hechos en este cambio de día. */
  attempts: number;
}

const initialState = (): ClockState => ({
  today: businessDateOf(Date.now()),
  confirmed: false,
  offsetMs: 0,
  pending: false,
  attempts: 0,
});

let state = initialState();
/**
 * `new-day`: empezó otro día (los datos anteriores a `confirmedAt` son del
 * día viejo). `correction`: la primera respuesta del backend corrigió la
 * suposición del dispositivo (los datos ya son del backend, no hay nada viejo).
 */
export type BusinessDayChange = 'new-day' | 'correction';
const dayListeners = new Set<(confirmedAt: number, change: BusinessDayChange) => void>();
const checkListeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let clocks = 0;

const serverNow = () => Date.now() + state.offsetMs;

export function getBusinessToday(): string {
  return state.today;
}

/**
 * Aviso cada vez que cambia el día que usa la interfaz (también sirve para
 * `useSyncExternalStore`). `confirmedAt` es el instante, en el reloj del
 * dispositivo, de la respuesta que lo confirmó: los datos anteriores a ese
 * instante son del día viejo.
 */
export function subscribeToBusinessDay(
  listener: (confirmedAt: number, change: BusinessDayChange) => void,
): () => void {
  dayListeners.add(listener);
  return () => {
    dayListeners.delete(listener);
  };
}

/** Pedido de confirmación: el reloj cree que empezó otro día y necesita que el backend lo diga. */
export function subscribeToDayCheck(listener: () => void): () => void {
  checkListeners.add(listener);
  return () => {
    checkListeners.delete(listener);
  };
}

function commit(day: string, confirmedAt: number, change: BusinessDayChange): void {
  state = { ...state, today: day, pending: false, attempts: 0 };
  for (const listener of [...dayListeners]) listener(confirmedAt, change);
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (clocks === 0) return;
  let delay: number;
  if (state.pending) {
    const wait = CONFIRMATION_RETRY_MS[state.attempts];
    if (wait === undefined) return;
    delay = wait;
  } else {
    delay =
      Math.max(0, startOfBusinessDay(nextDate(state.today)) - serverNow()) + DAY_CHANGE_MARGIN_MS;
  }
  timer = setTimeout(() => {
    timer = null;
    checkBusinessDay();
  }, delay);
}

/**
 * Mira el reloj (temporizador, pestaña visible, reconexión). Sin datos del
 * backend todavía, sigue al reloj; con datos, si ya debería ser otro día,
 * pide confirmación y NO cambia el día hasta que el backend lo informe.
 */
export function checkBusinessDay(): void {
  const expected = businessDateOf(serverNow());
  if (!state.confirmed) {
    if (expected !== state.today) commit(expected, Date.now(), 'new-day');
  } else if (expected > state.today) {
    state = state.pending
      ? { ...state, attempts: state.attempts + 1 }
      : { ...state, pending: true, attempts: 0 };
    for (const listener of [...checkListeners]) listener();
  } else if (state.pending) {
    state = { ...state, pending: false, attempts: 0 };
  }
  schedule();
}

export type ServerDayReport = 'current' | 'changed' | 'stale';

/**
 * Fecha de negocio (y, si la trae, hora) que informó una respuesta del
 * backend, recibida en `receivedAt` (reloj del dispositivo). Devuelve:
 * - `changed`: empezó otro día (o corrigió la suposición del dispositivo);
 * - `current`: el día no cambió (si había un cambio pendiente, el backend
 *   todavía no llegó a la medianoche y se vuelve a preguntar más tarde);
 * - `stale`: la respuesta es de un día anterior al ya confirmado (se pidió
 *   antes de la medianoche): quien la muestra tiene que revalidarla.
 */
export function reportServerDay(
  day: string,
  serverTime: number | null,
  receivedAt: number,
): ServerDayReport {
  if (!DATE_ONLY.test(day)) return 'current';
  if (serverTime !== null && Number.isFinite(serverTime)) {
    state = { ...state, offsetMs: serverTime - receivedAt };
  }
  const wasConfirmed = state.confirmed;
  state = { ...state, confirmed: true };
  let result: ServerDayReport = 'current';
  if (!wasConfirmed && day !== state.today) {
    commit(day, receivedAt, 'correction');
    result = 'changed';
  } else if (day > state.today) {
    commit(day, receivedAt, 'new-day');
    result = 'changed';
  } else if (day < state.today) {
    result = 'stale';
  } else if (state.pending && businessDateOf(serverNow()) <= state.today) {
    // La hora del servidor explica la diferencia: allá todavía no es medianoche.
    state = { ...state, pending: false, attempts: 0 };
  }
  schedule();
  return result;
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') checkBusinessDay();
}

/**
 * Enciende el reloj, contado por referencia: dos montajes (StrictMode,
 * pantallas) comparten UN temporizador y un solo par de listeners. Al
 * encenderse mira el reloj.
 */
export function startBusinessDayClock(): () => void {
  clocks += 1;
  if (clocks === 1) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', checkBusinessDay);
    checkBusinessDay();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clocks -= 1;
    if (clocks === 0) {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', checkBusinessDay);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}

/** Solo para tests: vuelve al estado inicial con el reloj apagado. */
export function resetBusinessDayForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  clocks = 0;
  dayListeners.clear();
  checkListeners.clear();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', checkBusinessDay);
  state = initialState();
}
