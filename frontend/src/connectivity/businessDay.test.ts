import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIRMATION_RETRY_MS,
  DAY_CHANGE_MARGIN_MS,
  businessDateOf,
  getBusinessToday,
  reportServerDay,
  resetBusinessDayForTests,
  startBusinessDayClock,
  startOfBusinessDay,
  subscribeToBusinessDay,
  subscribeToDayCheck,
} from './businessDay';

/** Instante `HH:MM:SS` de Buenos Aires (UTC−3) del día `YYYY-MM-DD`. */
const ar = (day: string, time = '12:00:00') => new Date(`${day}T${time}.000-03:00`);
const MINUTE = 60_000;

/** Enciende el reloj con el dispositivo en `device`. */
function startAt(device: Date) {
  vi.setSystemTime(device);
  resetBusinessDayForTests();
  const onDay = vi.fn();
  const onCheck = vi.fn();
  subscribeToBusinessDay(onDay);
  subscribeToDayCheck(onCheck);
  const stop = startBusinessDayClock();
  return { onDay, onCheck, stop };
}

/** Una respuesta del backend, recibida ahora: su día y, si la trae, su hora (desfase en ms respecto del dispositivo). */
const serverSays = (day: string, offsetMs: number | null = 0) =>
  reportServerDay(day, offsetMs === null ? null : Date.now() + offsetMs, Date.now());

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

describe('reloj del día — un solo temporizador, sin sondeo', () => {
  it('UN solo temporizador para toda la app, también con StrictMode y varios montajes', () => {
    vi.setSystemTime(ar('2026-10-25', '10:00:00'));
    resetBusinessDayForTests();
    startBusinessDayClock()(); // StrictMode: montar y desmontar…
    const stopFirst = startBusinessDayClock(); // …y volver a montar
    const stopSecond = startBusinessDayClock();
    expect(vi.getTimerCount()).toBe(1);
    stopSecond();
    stopSecond(); // detener dos veces no descuenta de más
    expect(vi.getTimerCount()).toBe(1);
    stopFirst();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sin datos del backend todavía, sigue al reloj del dispositivo', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:59:00'));
    vi.advanceTimersByTime(MINUTE + DAY_CHANGE_MARGIN_MS);
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(onCheck).not.toHaveBeenCalled();
    expect(getBusinessToday()).toBe('2026-10-26');
  });

  it('con datos del backend, el temporizador NO cambia el día: pide confirmación y espera la respuesta', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:59:00'));
    serverSays('2026-10-25');
    vi.advanceTimersByTime(MINUTE + DAY_CHANGE_MARGIN_MS);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onDay).not.toHaveBeenCalled();
    expect(getBusinessToday()).toBe('2026-10-25');

    expect(serverSays('2026-10-26')).toBe('changed');
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(onDay).toHaveBeenLastCalledWith(expect.any(Number), 'new-day');
    expect(getBusinessToday()).toBe('2026-10-26');
    // Durante el día no pasa nada, y el reloj nunca hace requests propios.
    vi.advanceTimersByTime(23 * 60 * MINUTE);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
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
  ])('cambio de %s confirmado por el backend', (_label, before, after) => {
    const { onDay, onCheck } = startAt(ar(before, '23:59:59'));
    serverSays(before);
    vi.advanceTimersByTime(1_000 + DAY_CHANGE_MARGIN_MS);
    expect(onCheck).toHaveBeenCalledTimes(1);
    serverSays(after);
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe(after);
  });
});

describe('dispositivo adelantado', () => {
  it('con la hora del servidor: su medianoche no cuenta; pide confirmación a la medianoche del servidor', () => {
    // Dispositivo 23:58, servidor 23:53 (5 minutos de diferencia).
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:58:00'));
    serverSays('2026-10-25', -5 * MINUTE);
    vi.advanceTimersByTime(2.5 * MINUTE); // dispositivo 00:00:30, servidor 23:55:30
    expect(onCheck).not.toHaveBeenCalled();
    expect(getBusinessToday()).toBe('2026-10-25');
    vi.advanceTimersByTime(4.5 * MINUTE); // dispositivo 00:05:00, servidor 00:00:00
    expect(onCheck).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DAY_CHANGE_MARGIN_MS);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onDay).not.toHaveBeenCalled();
    serverSays('2026-10-26', -5 * MINUTE);
    expect(onDay).toHaveBeenCalledTimes(1);
  });

  it('sin la hora del servidor: si el backend sigue en el día anterior, no cambia y reintenta con esperas acotadas', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:59:00'));
    serverSays('2026-10-25', null);
    vi.advanceTimersByTime(MINUTE + DAY_CHANGE_MARGIN_MS);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(serverSays('2026-10-25', null)).toBe('current');
    expect(getBusinessToday()).toBe('2026-10-25');
    expect(onDay).not.toHaveBeenCalled();

    vi.advanceTimersByTime(CONFIRMATION_RETRY_MS[0]);
    expect(onCheck).toHaveBeenCalledTimes(2);
    serverSays('2026-10-25', null);
    vi.advanceTimersByTime(CONFIRMATION_RETRY_MS[1]);
    expect(onCheck).toHaveBeenCalledTimes(3);
    expect(serverSays('2026-10-26', null)).toBe('changed');
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2026-10-26');
  });

  it('los reintentos se agotan: sin sondeo permanente hasta que vuelva la pestaña', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:59:00'));
    serverSays('2026-10-25', null);
    vi.advanceTimersByTime(MINUTE + DAY_CHANGE_MARGIN_MS);
    for (const wait of CONFIRMATION_RETRY_MS) {
      serverSays('2026-10-25', null);
      vi.advanceTimersByTime(wait);
    }
    expect(onCheck).toHaveBeenCalledTimes(1 + CONFIRMATION_RETRY_MS.length);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * MINUTE);
    expect(onCheck).toHaveBeenCalledTimes(1 + CONFIRMATION_RETRY_MS.length);
    expect(onDay).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(onCheck).toHaveBeenCalledTimes(2 + CONFIRMATION_RETRY_MS.length);
  });

  it('la primera respuesta corrige la suposición del dispositivo (corrección, no día nuevo)', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-26', '00:02:00'));
    expect(getBusinessToday()).toBe('2026-10-26');
    serverSays('2026-10-25', -5 * MINUTE);
    expect(getBusinessToday()).toBe('2026-10-25');
    expect(onDay).toHaveBeenLastCalledWith(expect.any(Number), 'correction');
    vi.advanceTimersByTime(3 * MINUTE + DAY_CHANGE_MARGIN_MS); // medianoche del servidor
    expect(onCheck).toHaveBeenCalledTimes(1);
  });
});

describe('dispositivo atrasado', () => {
  it('con la hora del servidor: pide confirmación a la medianoche del servidor, antes que la del dispositivo', () => {
    // Dispositivo 23:50, servidor 23:55.
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:50:00'));
    serverSays('2026-10-25', 5 * MINUTE);
    vi.advanceTimersByTime(5 * MINUTE + DAY_CHANGE_MARGIN_MS); // dispositivo 23:55:01
    expect(onCheck).toHaveBeenCalledTimes(1);
    serverSays('2026-10-26', 5 * MINUTE);
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(businessDateOf(Date.now())).toBe('2026-10-25'); // el dispositivo sigue en el anterior
  });

  it('sin la hora del servidor: una respuesta con el día nuevo lo cambia aunque el dispositivo siga en el anterior', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-25', '23:58:00'));
    serverSays('2026-10-25', null);
    vi.advanceTimersByTime(MINUTE);
    expect(serverSays('2026-10-26', null)).toBe('changed');
    expect(onDay).toHaveBeenCalledTimes(1);
    // Llega la medianoche del dispositivo: ya está confirmada, no se pide nada.
    vi.advanceTimersByTime(MINUTE + DAY_CHANGE_MARGIN_MS);
    expect(onCheck).not.toHaveBeenCalled();
  });
});

describe('respuestas viejas, pestaña oculta y reconexión', () => {
  it('una respuesta del día anterior después de confirmar el nuevo se marca vieja y no lo deshace', () => {
    const { onDay } = startAt(ar('2026-10-26', '00:00:05'));
    serverSays('2026-10-25');
    serverSays('2026-10-26');
    expect(serverSays('2026-10-25')).toBe('stale');
    expect(getBusinessToday()).toBe('2026-10-26');
    expect(onDay).toHaveBeenCalledTimes(2); // corrección inicial + día nuevo
  });

  it('pestaña oculta toda la noche: al volver pide confirmación y el día cambia con la respuesta', () => {
    const { onDay, onCheck } = startAt(ar('2026-10-25', '22:00:00'));
    serverSays('2026-10-25');
    // El navegador congeló el temporizador: el reloj avanza sin dispararlo.
    vi.setSystemTime(ar('2026-10-26', '08:00:00'));
    setVisibility('hidden');
    expect(onCheck).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2026-10-25');
    serverSays('2026-10-26');
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('al recuperar la conexión pide confirmación', () => {
    const { onDay, onCheck } = startAt(ar('2026-12-31', '23:00:00'));
    serverSays('2026-12-31');
    vi.setSystemTime(ar('2027-01-01', '07:30:00'));
    window.dispatchEvent(new Event('online'));
    expect(onCheck).toHaveBeenCalledTimes(1);
    serverSays('2027-01-01');
    expect(onDay).toHaveBeenCalledTimes(1);
    expect(getBusinessToday()).toBe('2027-01-01');
  });

  it('el mismo día, volver a la pestaña o reconectar no pide nada', () => {
    const { onCheck } = startAt(ar('2026-10-26', '09:00:00'));
    serverSays('2026-10-26');
    vi.setSystemTime(ar('2026-10-26', '18:00:00'));
    setVisibility('visible');
    window.dispatchEvent(new Event('online'));
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('apagado (sin sesión): sin temporizador ni listeners', () => {
    const { onCheck, stop } = startAt(ar('2026-10-25', '23:00:00'));
    serverSays('2026-10-25');
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(ar('2026-10-26', '08:00:00'));
    setVisibility('visible');
    expect(onCheck).not.toHaveBeenCalled();
  });
});
