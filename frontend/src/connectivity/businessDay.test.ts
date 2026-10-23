import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAY_CHANGE_MARGIN_MS,
  businessDateOf,
  getBusinessToday,
  resetBusinessDayForTests,
  startBusinessDayClock,
  startOfBusinessDay,
  subscribeToBusinessDay,
} from './businessDay';

/** Instante `HH:MM:SS` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00:00') => new Date(`${day}T${time}.000-03:00`);

function startAt(instant: Date) {
  vi.setSystemTime(instant);
  resetBusinessDayForTests();
  const onDayChange = vi.fn();
  subscribeToBusinessDay(onDayChange);
  const stop = startBusinessDayClock();
  return { onDayChange, stop };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetBusinessDayForTests();
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
});

describe('día de negocio — fecha en la zona de Buenos Aires', () => {
  it('23:30 en Buenos Aires sigue siendo el día local aunque en UTC ya sea el siguiente', () => {
    expect(businessDateOf(Date.parse('2026-10-26T02:30:00.000Z'))).toBe('2026-10-25');
    expect(businessDateOf(Date.parse('2026-10-26T03:00:00.000Z'))).toBe('2026-10-26');
    expect(startOfBusinessDay('2026-10-26')).toBe(Date.parse('2026-10-26T03:00:00.000Z'));
  });
});

describe('reloj del día de negocio', () => {
  it('UN solo temporizador para toda la app, también con StrictMode y varios montajes', () => {
    vi.setSystemTime(ar('2026-10-25', '10:00:00'));
    resetBusinessDayForTests();
    // StrictMode: montar, desmontar y volver a montar.
    startBusinessDayClock()();
    const stopFirst = startBusinessDayClock();
    const stopSecond = startBusinessDayClock();
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
    stopSecond(); // detener dos veces no descuenta de más
    expect(vi.getTimerCount()).toBe(1);
    stopFirst();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a medianoche (+ margen) avisa UNA vez y se reprograma para la siguiente; sin sondeo', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { onDayChange } = startAt(ar('2026-10-25', '23:59:00'));
    vi.advanceTimersByTime(60_000);
    expect(onDayChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DAY_CHANGE_MARGIN_MS);
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2026-10-26');
    expect(vi.getTimerCount()).toBe(1);
    // Durante el día no pasa nada ni se pide nada.
    vi.advanceTimersByTime(23 * 60 * 60_000);
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ['semana (domingo → lunes)', '2026-10-25', '2026-10-26'],
    ['quincena (15 → 16)', '2026-10-15', '2026-10-16'],
    ['mes y bimestre (31/10 → 01/11)', '2026-10-31', '2026-11-01'],
    ['bimestre ene–feb → mar–abr (28/02 → 01/03)', '2027-02-28', '2027-03-01'],
    ['año bisiesto (29/02 → 01/03)', '2028-02-29', '2028-03-01'],
    ['año (31/12 → 01/01)', '2026-12-31', '2027-01-01'],
  ])('cambio de %s', (_label, before, after) => {
    const { onDayChange } = startAt(ar(before, '23:59:59'));
    vi.advanceTimersByTime(1_000 + DAY_CHANGE_MARGIN_MS);
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe(after);
  });

  it('pestaña oculta: al volver a verse comprueba el día (el temporizador pudo demorarse)', () => {
    const { onDayChange } = startAt(ar('2026-10-25', '22:00:00'));
    // El navegador congeló el temporizador: el reloj avanza sin dispararlo.
    vi.setSystemTime(ar('2026-10-26', '08:00:00'));
    setVisibility('hidden');
    expect(onDayChange).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2026-10-26');
    // Se reprogramó: sigue habiendo un solo temporizador y no vuelve a avisar.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(onDayChange).toHaveBeenCalledTimes(1);
  });

  it('al recuperar la conexión comprueba el día', () => {
    const { onDayChange } = startAt(ar('2026-12-31', '23:00:00'));
    vi.setSystemTime(ar('2027-01-01', '07:30:00'));
    window.dispatchEvent(new Event('online'));
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2027-01-01');
  });

  it('volver a la pestaña el mismo día no avisa', () => {
    const { onDayChange } = startAt(ar('2026-10-26', '09:00:00'));
    vi.setSystemTime(ar('2026-10-26', '18:00:00'));
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    expect(onDayChange).not.toHaveBeenCalled();
  });

  it('apagado (sin sesión): sin temporizador ni listeners', () => {
    const { onDayChange, stop } = startAt(ar('2026-10-25', '23:00:00'));
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(ar('2026-10-26', '08:00:00'));
    setVisibility('visible');
    expect(onDayChange).not.toHaveBeenCalled();
  });

  it('al encenderse mira el reloj: si quedó en un día viejo, avisa', () => {
    vi.setSystemTime(ar('2026-10-25', '23:00:00'));
    resetBusinessDayForTests();
    const onDayChange = vi.fn();
    subscribeToBusinessDay(onDayChange);
    vi.setSystemTime(ar('2026-10-26', '09:00:00'));
    const stop = startBusinessDayClock();
    expect(onDayChange).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2026-10-26');
    stop();
  });
});
