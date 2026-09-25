import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchPhotoContent } from '../../api/moreApi';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

const watchedClients = new WeakSet<QueryClient>();

/** Libera la object URL cuando su entrada sale de la caché (vencimiento, logout, cambio de sesión). */
function revokeOnRemoval(queryClient: QueryClient): void {
  if (watchedClients.has(queryClient)) return;
  watchedClients.add(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (event.type === 'removed' && key[2] === 'more' && key[3] === 'photo-content') {
      const url = event.query.state.data;
      if (typeof url === 'string') URL.revokeObjectURL(url);
    }
  });
}

/** `true` cuando el elemento entra (o está por entrar) en pantalla; sin IntersectionObserver, siempre. */
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

interface GalleryImageProps {
  photoId: string;
  alt: string;
  className?: string;
  /** Miniaturas: se piden recién cerca del viewport. El visor la pide de inmediato. */
  lazy?: boolean;
}

/**
 * Imagen de la galería por el proxy autenticado del backend (nunca una URL
 * del bucket), cacheada en memoria por id (inmutable) y nunca en storage.
 */
export function GalleryImage({ photoId, alt, className, lazy = true }: GalleryImageProps) {
  const queryClient = useQueryClient();
  revokeOnRemoval(queryClient);
  const { userId, enabled } = useSessionScope();
  const { ref, visible } = useNearViewport<HTMLSpanElement>();
  const query = useQuery({
    queryKey: queryKeys.more.photoContent(userId, photoId),
    queryFn: async () => URL.createObjectURL(await fetchPhotoContent(photoId)),
    enabled: enabled && (!lazy || visible),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <span ref={ref} className={['gallery-image', className].filter(Boolean).join(' ')}>
      {query.data ? (
        <img src={query.data} alt={alt} />
      ) : (
        <span className="gallery-image__placeholder" aria-hidden="true">
          {query.isError ? '⚠️' : '📷'}
        </span>
      )}
    </span>
  );
}
