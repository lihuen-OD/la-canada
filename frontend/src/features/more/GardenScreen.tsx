import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { fetchGardenPlanVersions } from '../../api/moreApi';
import type { GardenPlanVersion } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { STALE_TIME } from '../../api/queryClient';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { formatDateTime } from '../../utils/dateFormat';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { GardenPlanImage, GardenPlanThumbnail } from './GardenPlanImage';
import { GardenPublishDialog } from './GardenPublishDialog';
import { MoreBackLink } from './MoreBackLink';
import { GARDEN_PLAN_TYPES } from './moreLabels';
import { useMoreCache } from './useMoreCache';

const PAGE_SIZE = 20;

/**
 * 🌳 Jardín (`/more/garden`, Etapa 5Y): el plano vigente del jardín y su
 * historial de versiones. Ver el plano y el historial es de todos; publicar
 * una versión nueva es solo ADMIN. Las versiones son inmutables: no hay
 * editar, restaurar ni eliminar, y publicar de nuevo conserva la anterior.
 *
 * Requests: UNA lista paginada al abrir (que ya trae la versión vigente) y,
 * como mucho, la imagen de la versión que se está mirando. No se precargan
 * imágenes del historial ni se piden al volver atrás (caché de TanStack
 * Query, `staleTime` de catálogo: 5 min).
 */
export default function GardenScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterGardenChange } = useMoreCache();
  const [viewing, setViewing] = useState<GardenPlanVersion | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handleSessionExpired = useCallback(() => void logout(), [logout]);

  const list = useInfiniteQuery({
    queryKey: queryKeys.more.garden(userId),
    queryFn: ({ pageParam }) => fetchGardenPlanVersions(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    // El historial solo crece al publicar, y eso invalida la caché: 5 min.
    staleTime: STALE_TIME.catalog,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(list.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const seen = new Set<string>();
  const versions = (list.data?.pages.flatMap((page) => page.versions) ?? []).filter((version) =>
    seen.has(version.id) ? false : (seen.add(version.id), true),
  );
  const current = list.data?.pages[0]?.current ?? null;
  const storageReady = list.data?.pages[0]?.gardenStorage === 'configured';

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">🌳 </span>Jardín
          </>
        }
        refreshing={Boolean(list.data) && list.isFetching && !list.isFetchingNextPage}
        actions={<MoreBackLink />}
      />

      {isAdmin ? (
        <button
          type="button"
          className="upload-zone"
          disabled={!storageReady}
          onClick={() => inputRef.current?.click()}
          aria-describedby={storageReady ? undefined : 'garden-storage-hint'}
        >
          <span className="upload-zone__icon" aria-hidden="true">
            🗺️
          </span>
          <span className="upload-zone__title">Publicar nueva versión</span>
          <span className="upload-zone__hint">Tocá para seleccionar el plano</span>
        </button>
      ) : null}
      {list.data && !storageReady ? (
        <p id="garden-storage-hint" className="notice notice--warning">
          El plano no está disponible: falta configurar el almacenamiento.
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={GARDEN_PLAN_TYPES.join(',')}
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />

      {!list.data ? (
        list.isError ? (
          <ErrorState
            title="No pudimos cargar el plano del jardín"
            description={errorMessageOf(list.error)}
            onRetry={() => void list.refetch()}
          />
        ) : (
          <LoadingState label="Cargando el plano…" />
        )
      ) : !current ? (
        <EmptyState
          icon={<span>🌳</span>}
          title="Todavía no hay un plano del jardín."
          description={
            isAdmin
              ? 'Publicá la primera versión para que todos la vean.'
              : 'Cuando se publique la primera versión, va a aparecer acá.'
          }
        />
      ) : (
        <div className={list.isPlaceholderData ? 'is-stale' : undefined}>
          <section className="garden-current" aria-label="Plano vigente">
            <div className="garden-current__head">
              <h2 className="garden-current__title">
                <span aria-hidden="true">🗺️ </span>Versión {current.versionNumber}
                <span className="garden-current__tag">Vigente</span>
              </h2>
              <p className="garden-current__meta">
                {[`Publicada por ${current.publishedBy}`, formatDateTime(current.createdAt)].join(
                  ' · ',
                )}
              </p>
            </div>
            <button
              type="button"
              className="garden-current__open"
              onClick={() => setViewing(current)}
              aria-label={`Ver la versión ${current.versionNumber} en pantalla completa`}
            >
              <GardenPlanImage
                versionId={current.id}
                alt={`Plano del jardín, versión ${current.versionNumber}`}
              />
            </button>
          </section>

          <h2 className="garden-history__title">Historial</h2>
          <ul className="garden-history" aria-label="Versiones del plano">
            {versions.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  className={`garden-history__item${version.id === current.id ? ' is-current' : ''}`}
                  onClick={() => setViewing(version)}
                  aria-label={`Ver la versión ${version.versionNumber}, publicada por ${version.publishedBy}`}
                >
                  <GardenPlanThumbnail
                    versionId={version.id}
                    alt={`Miniatura del plano, versión ${version.versionNumber}`}
                  />
                  <span className="garden-history__text">
                    <span className="garden-history__label">
                      Versión {version.versionNumber}
                      {version.id === current.id ? ' · vigente' : ''}
                    </span>
                    <span className="garden-history__meta">
                      {[version.publishedBy, formatDateTime(version.createdAt)].join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              fullWidth
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage({ cancelRefetch: false })}
            >
              Cargar más
            </Button>
          ) : null}
        </div>
      )}

      {file ? (
        <GardenPublishDialog
          file={file}
          onClose={() => setFile(null)}
          onSaved={() => {
            setFile(null);
            afterGardenChange();
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}

      {viewing ? (
        <Modal
          titleId="garden-viewer-title"
          onRequestClose={() => setViewing(null)}
          variant="viewer"
        >
          <div className="photo-viewer">
            <GardenPlanImage
              versionId={viewing.id}
              alt={`Plano del jardín, versión ${viewing.versionNumber}`}
              className="photo-viewer__image"
            />
            <h2 id="garden-viewer-title" className="photo-viewer__title">
              Versión {viewing.versionNumber}
              {viewing.id === current?.id ? ' · vigente' : ''}
            </h2>
            <p className="photo-viewer__meta">
              {[`Publicada por ${viewing.publishedBy}`, formatDateTime(viewing.createdAt)].join(
                ' · ',
              )}
            </p>
            <div className="photo-viewer__actions">
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
