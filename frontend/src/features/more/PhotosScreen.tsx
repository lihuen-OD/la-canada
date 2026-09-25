import { useCallback, useEffect, useRef, useState } from 'react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { deletePhoto, fetchPhotos } from '../../api/moreApi';
import type { GalleryCategory, GalleryPhoto } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { GalleryImage } from './GalleryImage';
import { MoreBackLink } from './MoreBackLink';
import { PhotoUploadDialog } from './PhotoUploadDialog';
import {
  PHOTO_CATEGORY_ICON,
  PHOTO_CATEGORY_TEXT,
  PHOTO_FILTERS,
  PHOTO_TYPES,
  timeAgo,
} from './moreLabels';
import { useMoreCache } from './useMoreCache';

const PAGE_SIZE = 24;

/**
 * 📸 Fotos (`pg-fotos`): chips Todas/Tareas/Recuerdos, "Subir foto", grilla
 * (3 columnas en móvil, 5 en escritorio) y visor. Todos suben; eliminar es
 * solo de ADMIN (diferencia aprobada: es irreversible). Las imágenes viven en
 * el almacenamiento privado y se piden por el backend al entrar en pantalla.
 */
export default function PhotosScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterPhotoChange } = useMoreCache();
  const [filter, setFilter] = useState<GalleryCategory | 'all'>('all');
  const [file, setFile] = useState<File | null>(null);
  const [viewing, setViewing] = useState<GalleryPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handleSessionExpired = useCallback(() => void logout(), [logout]);

  const list = useInfiniteQuery({
    queryKey: queryKeys.more.photos(userId, filter),
    queryFn: ({ pageParam }) =>
      fetchPhotos({
        category: filter === 'all' ? undefined : filter,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(list.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const seen = new Set<string>();
  const photos = (list.data?.pages.flatMap((page) => page.photos) ?? []).filter((photo) =>
    seen.has(photo.id) ? false : (seen.add(photo.id), true),
  );
  const storageReady = list.data?.pages[0]?.photoStorage === 'configured';

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📸 </span>Fotos
          </>
        }
        refreshing={Boolean(list.data) && list.isFetching && !list.isFetchingNextPage}
        actions={<MoreBackLink />}
      />
      <div className="filter-scroller" role="group" aria-label="Filtrar por tipo">
        {PHOTO_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={filter === option.value}
            onSelect={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <button
        type="button"
        className="upload-zone"
        disabled={!storageReady}
        onClick={() => inputRef.current?.click()}
        aria-describedby={storageReady ? undefined : 'photos-storage-hint'}
      >
        <span className="upload-zone__icon" aria-hidden="true">
          📷
        </span>
        <span className="upload-zone__title">Subir foto</span>
        <span className="upload-zone__hint">Tocá para seleccionar</span>
      </button>
      {list.data && !storageReady ? (
        <p id="photos-storage-hint" className="notice notice--warning">
          Las fotos no están disponibles: falta configurar el almacenamiento.
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_TYPES.join(',')}
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
            title="No pudimos cargar las fotos"
            description={errorMessageOf(list.error)}
            onRetry={() => void list.refetch()}
          />
        ) : (
          <LoadingState label="Cargando fotos…" />
        )
      ) : photos.length === 0 ? (
        <EmptyState icon={<span>📷</span>} title="Sin fotos aún." description="Subí la primera." />
      ) : (
        <div className={list.isPlaceholderData ? 'is-stale' : undefined}>
          <ul className="gallery" aria-label="Fotos">
            {photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  className="gallery__item"
                  onClick={() => setViewing(photo)}
                  aria-label={`Ver ${photo.title}`}
                >
                  <GalleryImage photoId={photo.id} alt="" />
                  <span
                    className={`gallery__tag gallery__tag--${photo.category.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {PHOTO_CATEGORY_ICON[photo.category]}
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
        <PhotoUploadDialog
          file={file}
          onClose={() => setFile(null)}
          onSaved={() => {
            setFile(null);
            afterPhotoChange();
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}

      {viewing && !confirmDelete ? (
        <Modal
          titleId="photo-viewer-title"
          onRequestClose={() => setViewing(null)}
          variant="viewer"
        >
          <div className="photo-viewer">
            <GalleryImage
              photoId={viewing.id}
              alt={viewing.title}
              lazy={false}
              className="photo-viewer__image"
            />
            <h2 id="photo-viewer-title" className="photo-viewer__title">
              {viewing.title}
            </h2>
            <p className="photo-viewer__meta">
              {[
                viewing.employee?.displayName,
                PHOTO_CATEGORY_TEXT[viewing.category],
                timeAgo(viewing.createdAt),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="photo-viewer__actions">
              {isAdmin ? (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <span aria-hidden="true">🗑 </span>Eliminar
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setViewing(null)}>
                Cerrar
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {viewing && confirmDelete ? (
        <ConfirmDialog
          title="¿Eliminar?"
          description={`La foto "${viewing.title}" se eliminará de la galería.`}
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await deletePhoto(viewing.id);
            } catch (caught) {
              if (isSessionExpired(caught)) return handleSessionExpired();
              throw humanError(caught);
            }
            setConfirmDelete(false);
            setViewing(null);
            afterPhotoChange();
          }}
        />
      ) : null}
    </div>
  );
}
