import { useEffect, useState, useSyncExternalStore } from 'react';
import { getRefreshRecovery, subscribeToRefreshRecovery } from '../auth/refreshRecovery';
import type { RefreshRecovery } from '../auth/refreshRecovery';
import {
  LONG_WAIT_MS,
  WAKE_NOTICE_DELAY_MS,
  getBackendAvailability,
  subscribeToBackendAvailability,
} from './backendAvailability';
import type { BackendAvailabilitySnapshot } from './backendAvailability';

export function useBackendAvailability(): BackendAvailabilitySnapshot {
  return useSyncExternalStore(subscribeToBackendAvailability, getBackendAvailability);
}

export function useRefreshRecovery(): RefreshRecovery {
  return useSyncExternalStore(subscribeToRefreshRecovery, getRefreshRecovery);
}

/** Reloj de pantalla (no toca la red): solo corre mientras `intervalMs` no es `null`. */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (intervalMs === null) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface WakeNotice {
  snapshot: BackendAvailabilitySnapshot;
  /** Hay que mostrar el aviso: `offline`, o un episodio que ya superó la demora anti-parpadeo. */
  visible: boolean;
  offline: boolean;
  /** Pasó más de un minuto sin recuperar. */
  longWait: boolean;
  elapsedSeconds: number;
  /** Segundos hasta el próximo intento programado, o `null` si hay uno en vuelo o está pausado. */
  secondsToNextAttempt: number | null;
}

/**
 * Estado derivado del aviso de "backend despertando". El reloj de medio
 * segundo solo corre durante un episodio; con el backend disponible no hay
 * ningún timer activo.
 */
export function useWakeNotice(): WakeNotice {
  const snapshot = useBackendAvailability();
  const active = snapshot.since !== null && snapshot.status !== 'online';
  const now = useNow(active ? 500 : null);
  const elapsed = active ? Math.max(0, now - (snapshot.since ?? now)) : 0;
  const offline = snapshot.status === 'offline';
  return {
    snapshot,
    visible: active && (offline || elapsed >= WAKE_NOTICE_DELAY_MS),
    offline,
    longWait: active && (snapshot.status === 'degraded' || elapsed >= LONG_WAIT_MS),
    elapsedSeconds: Math.floor(elapsed / 1000),
    secondsToNextAttempt:
      active && snapshot.nextAttemptAt !== null
        ? Math.max(0, Math.ceil((snapshot.nextAttemptAt - now) / 1000))
        : null,
  };
}
