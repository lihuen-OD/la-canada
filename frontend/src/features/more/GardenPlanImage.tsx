import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchGardenPlanContent } from '../../api/moreApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

const watchedClients = new WeakSet<QueryClient>();

/** Libera la object URL cuando su entrada sale de la caché (vencimiento, logout, cambio de sesión). */
function revokeOnRemoval(queryClient: QueryClient): void {
  if (watchedClients.has(queryClient)) return;
  watchedClients.add(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (event.type === 'removed' && key[2] === 'more' && key[3] === 'garden-content') {
      const url = event.query.state.data;
      if (typeof url === 'string') URL.revokeObjectURL(url);
    }
  });
}

/**
 * Plano de UNA versión por el proxy autenticado del backend (nunca una URL
 * del bucket). Cacheado en memoria por id e inmutable: el archivo de una
 * versión publicada no cambia nunca, así que `staleTime: Infinity` y jamás se
 * vuelve a pedir. Solo se descarga la versión que se está mirando — abrir la
 * pantalla NO precarga el historial.
 */
function useGardenPlanObjectUrl(versionId: string, active: boolean) {
  const queryClient = useQueryClient();
  revokeOnRemoval(queryClient);
  const { userId, enabled } = useSessionScope();
  return useQuery({
    queryKey: queryKeys.more.gardenContent(userId, versionId),
    queryFn: async () => URL.createObjectURL(await fetchGardenPlanContent(versionId)),
    enabled: enabled && active,
    staleTime: Infinity,
    retry: false,
  });
}

interface GardenPlanImageProps {
  versionId: string;
  alt: string;
  className?: string;
}

/** Plano a tamaño completo, centrado y con `contain` (nunca recortado ni deformado). */
export function GardenPlanImage({ versionId, alt, className }: GardenPlanImageProps) {
  const query = useGardenPlanObjectUrl(versionId, true);
  return (
    <span className={['garden-plan-image', className].filter(Boolean).join(' ')}>
      {query.data ? (
        <img src={query.data} alt={alt} />
      ) : (
        <span className="garden-plan-image__placeholder" aria-hidden="true">
          {query.isError ? '⚠️' : '🌳'}
        </span>
      )}
    </span>
  );
}

/** `true` cuando el elemento entra (o está por entrar) en pantalla. */
function useNearViewport<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !ref.current) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}

/** Miniatura del historial: se pide recién cerca del viewport, no al abrir. */
export function GardenPlanThumbnail({ versionId, alt }: { versionId: string; alt: string }) {
  const { ref, visible } = useNearViewport<HTMLSpanElement>();
  const query = useGardenPlanObjectUrl(versionId, visible);
  return (
    <span ref={ref} className="garden-plan-thumb">
      {query.data ? <img src={query.data} alt={alt} /> : <span aria-hidden="true">🌳</span>}
    </span>
  );
}
