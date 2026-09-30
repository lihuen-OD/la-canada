import { useEffect } from 'react';
import { usePetsCache } from './usePetsCache';

/**
 * Revalida Mascotas cuando empieza el próximo día de `BUSINESS_TIME_ZONE`
 * (`refreshAt` lo calcula el backend): un único temporizador hasta esa hora y,
 * si la pestaña estuvo oculta, al volver a ser visible. Sin sondeo constante
 * y sin decidir el día con la zona del navegador.
 */
export function useBusinessDayRefresh(refreshAt: string | undefined): void {
  const { afterDayChange } = usePetsCache();
  useEffect(() => {
    if (!refreshAt) return undefined;
    const at = Date.parse(refreshAt);
    if (!Number.isFinite(at)) return undefined;
    const due = () => Date.now() >= at;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && due()) afterDayChange();
    };
    // Un segundo de margen para que el backend ya esté en el día nuevo.
    const timer = window.setTimeout(afterDayChange, Math.max(0, at - Date.now()) + 1_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshAt, afterDayChange]);
}
