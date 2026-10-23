import { BUSINESS_TIME_ZONE } from '../utils/dateFormat';

/**
 * Reloj del día de negocio en el navegador — ver docs/ARCHITECTURE.md §39.
 *
 * Una pantalla que queda abierta a medianoche tiene que pasar sola al día
 * nuevo, y con él a la semana, quincena, mes, bimestre o año nuevos: todos
 * esos límites caen en una medianoche de `BUSINESS_TIME_ZONE`. Este módulo
 * es la ÚNICA pieza que la vigila:
 *
 * - estado a nivel de módulo, como `backendAvailability`: StrictMode, los
 *   cambios de ruta y los componentes que lo leen no lo reinician ni lo
 *   duplican;
 * - UN solo temporizador para toda la app, programado para la próxima
 *   medianoche de negocio (más un margen para que el backend ya esté en el
 *   día nuevo). No hay sondeo ni requests propios: lo que cambia al pasar el
 *   día lo revalida quien se suscribe (`BusinessDayRefresh`);
 * - al volver a la pestaña y al recuperar la conexión vuelve a mirar el
 *   reloj: con la pestaña oculta o el equipo suspendido, un temporizador se
 *   demora;
 * - el día sale de `Intl` en la zona de negocio, nunca de la zona del
 *   navegador. Solo decide CUÁNDO revalidar: períodos, estados y cálculos
 *   siguen siendo del backend.
 */

/** Margen después de la medianoche para que el backend ya esté en el día nuevo. */
export const DAY_CHANGE_MARGIN_MS = 1_000;

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

let today = businessDateOf(Date.now());
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let clocks = 0;

export function getBusinessToday(): string {
  return today;
}

/** Aviso cada vez que empieza un día de negocio nuevo (también sirve para `useSyncExternalStore`). */
export function subscribeToBusinessDay(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  const delay =
    Math.max(0, startOfBusinessDay(nextDate(today)) - Date.now()) + DAY_CHANGE_MARGIN_MS;
  timer = setTimeout(() => {
    timer = null;
    checkBusinessDay();
  }, delay);
}

/** Mira el reloj: si cambió el día de negocio avisa una sola vez; con el reloj encendido, reprograma. */
export function checkBusinessDay(): void {
  const current = businessDateOf(Date.now());
  if (current !== today) {
    today = current;
    for (const listener of [...listeners]) listener();
  }
  if (clocks > 0) schedule();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') checkBusinessDay();
}

/**
 * Enciende el reloj, contado por referencia: dos montajes (StrictMode,
 * pantallas) comparten UN temporizador y un solo par de listeners. Al
 * encenderse mira el reloj (pudo quedar en un día viejo sin sesión).
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
  listeners.clear();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', checkBusinessDay);
  today = businessDateOf(Date.now());
}
