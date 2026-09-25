import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { isSessionExpired } from './stockErrors';

export const SEARCH_DEBOUNCE_MS = 350;

/**
 * Búsqueda debounceada: el input responde al instante y el valor
 * comprometido (el que viaja al backend) cambia recién tras la pausa. El
 * valor inicial es el comprometido, así volver a una vista conserva su texto.
 */
export function useDebouncedSearch(
  committed: string,
  onCommit: (value: string) => void,
): [string, (value: string) => void] {
  const [input, setInput] = useState(committed);
  useEffect(() => {
    const next = input.trim();
    if (next === committed) return;
    const timer = window.setTimeout(() => onCommit(next), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input, committed, onCommit]);
  return [input, setInput];
}

/** Un 401 que sobrevivió al refresh-y-reintento central cierra la sesión (una vez). */
export function useSessionExpiry(...errors: unknown[]): () => void {
  const { logout } = useAuth();
  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);
  const expired = errors.some(isSessionExpired);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  return handleSessionExpired;
}
