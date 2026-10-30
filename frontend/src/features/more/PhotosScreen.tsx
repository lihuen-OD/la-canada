import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { deletePhoto, fetchPhotos } from '../../api/moreApi';
import type { GalleryCategory, GalleryPhoto, PhotoFolder, PhotoScope } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Chip } from '../../components/ui/Chip';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { GalleryImage } from './GalleryImage';
import { MoreBackLink } from './MoreBackLink';
import {
  DeleteFolderDialog,
  FolderActionsMenu,
  FolderFormDialog,
  MovePhotoDialog,
} from './PhotoFolderDialogs';
import { PhotoUploadZone } from './PhotoUploadZone';
import { PHOTO_CATEGORY_ICON, PHOTO_CATEGORY_TEXT, PHOTO_FILTERS, timeAgo } from './moreLabels';
import {
  ALL_PHOTOS_ICON,
  ALL_PHOTOS_LABEL,
  FOLDER_ICON,
  UNFILED_ICON,
  UNFILED_LABEL,
  folderLabel,
  photoCountLabel,
  usePhotoFolders,
} from './photoFolders';
import { useMoreCache } from './useMoreCache';

const PAGE_SIZE = 24;

/**
 * 📸 Una parte de la galería: «Todas las fotos» (`/more/photos/all`), «Sin
 * carpeta» (`/more/photos/unfiled`) o una carpeta
 * (`/more/photos/folders/:folderId`, se puede recargar o compartir). Cada
 * una conserva lo de siempre: chips Todas/Tareas/Recuerdos, "Subir foto"
 * (con esta carpeta preseleccionada), grilla paginada y visor. Recuerdos y
 * evidencias siguen siendo tipos, independientes de la carpeta.
 */
export default function PhotosScreen({ scope }: { scope?: 'all' | 'none' }) {
  const { folderId } = useParams();
  const resolved: PhotoScope = scope ?? folderId?.toLowerCase() ?? 'all';
  // Otra carpeta = otra pantalla: filtro, visor y diálogos empiezan de cero.
  return <PhotoGallery key={resolved} scope={resolved} />;
}

function PhotoGallery({ scope }: { scope: PhotoScope }) {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const { userId, enabled } = useSessionScope();
  const cache = useMoreCache();
  const folders = usePhotoFolders();
  const [filter, setFilter] = useState<GalleryCategory | 'all'>('all');
  const [viewing, setViewing] = useState<GalleryPhoto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const [renaming, setRenaming] = useState<PhotoFolder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<PhotoFolder | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const handleSessionExpired = useCallback(() => void logout(), [logout]);

  const isFolder = scope !== 'all' && scope !== 'none';
  const folder = isFolder ? folders.data?.folders.find((item) => item.id === scope) : undefined;
  // El listado de carpetas ya llegó y esta no está: eliminada o inexistente.
  const missingInList = isFolder && Boolean(folders.data) && !folder;

  const list = useInfiniteQuery({
    queryKey: queryKeys.more.photos(userId, scope, filter),
    queryFn: ({ pageParam }) =>
      fetchPhotos({
        category: filter === 'all' ? undefined : filter,
        scope,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: enabled && !missingInList,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(list.error) || isSessionExpired(folders.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  const folderGone = missingInList || errorCodeOf(list.error) === 'PHOTO_FOLDER_NOT_FOUND';

  const seen = new Set<string>();
  const photos = (list.data?.pages.flatMap((page) => page.photos) ?? []).filter((photo) =>
    seen.has(photo.id) ? false : (seen.add(photo.id), true),
  );
  const storage = folders.data?.photoStorage ?? list.data?.pages[0]?.photoStorage;
  const count = !folders.data
    ? undefined
    : scope === 'all'
      ? folders.data.all.photoCount
      : scope === 'none'
        ? folders.data.unfiled.photoCount
        : folder?.photoCount;
  const title =
    scope === 'all' ? (
      <>
        <span aria-hidden="true">{ALL_PHOTOS_ICON} </span>
        {ALL_PHOTOS_LABEL}
      </>
    ) : scope === 'none' ? (
      <>
        <span aria-hidden="true">{UNFILED_ICON} </span>
        {UNFILED_LABEL}
      </>
    ) : (
      <>
        <span aria-hidden="true">{FOLDER_ICON} </span>
        {folder?.name ?? 'Carpeta'}
      </>
    );

  /** Conflicto al mover: se cierra todo, se avisa y se revalida lo afectado. */
  function showConflict(message: string): void {
    setMoving(false);
    setViewing(null);
    setNotice({ text: message, tone: 'error' });
    cache.refreshPhotoFolders(scope === 'none' ? null : scope, 'all');
  }

  if (folderGone) {
    return (
      <div className="more">
        <PageHeader title={title} actions={<MoreBackLink to="/more/photos" label="Fotos" />} />
        <EmptyState
          icon={<span>{FOLDER_ICON}</span>}
          title="Esta carpeta no existe o fue eliminada."
          description={
            <Link to="/more/photos" className={buttonClassName({ variant: 'secondary' })}>
              Volver a Fotos
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="more">
      <PageHeader
        title={title}
        description={count === undefined ? undefined : photoCountLabel(count)}
        refreshing={
          (Boolean(list.data) && list.isFetching && !list.isFetchingNextPage) ||
          (Boolean(folders.data) && folders.isFetching)
        }
        actions={
          <div className="photo-gallery__actions">
            {folder ? (
              <FolderActionsMenu
                folder={folder}
                onRename={() => setRenaming(folder)}
                onDelete={() => setDeletingFolder(folder)}
              />
            ) : null}
            <MoreBackLink to="/more/photos" label="Fotos" />
          </div>
        }
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

      <PhotoUploadZone
        storage={storage}
        defaultFolderId={isFolder ? scope : null}
        onUploaded={(photo) => {
          cache.afterPhotoChange(photo.folderId);
          const here = scope === 'all' || (photo.folderId ?? 'none') === scope;
          setNotice(
            here
              ? null
              : {
                  text: `La foto se guardó en «${folderLabel(folders.data?.folders, photo.folderId)}».`,
                  tone: 'info',
                },
          );
        }}
        onSessionExpired={handleSessionExpired}
      />
      {notice ? (
        <p
          className={`notice ${notice.tone === 'error' ? 'notice--warning' : 'notice--positive'}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

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
        <EmptyState
          icon={<span>📷</span>}
          title={isFolder || scope === 'none' ? 'No hay fotos acá.' : 'Sin fotos aún.'}
          description={
            isFolder
              ? 'Subí una foto o mové fotos a esta carpeta.'
              : scope === 'none'
                ? 'Todas las fotos están en alguna carpeta.'
                : 'Subí la primera.'
          }
        />
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

      {viewing && !confirmDelete && !moving ? (
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
            <p className="photo-viewer__meta photo-viewer__folder">
              <span aria-hidden="true">{viewing.folderId ? FOLDER_ICON : UNFILED_ICON} </span>
              {folderLabel(folders.data?.folders, viewing.folderId)}
            </p>
            <div className="photo-viewer__actions">
              <Button variant="secondary" onClick={() => setMoving(true)}>
                <span aria-hidden="true">{FOLDER_ICON} </span>Mover a carpeta
              </Button>
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
      {viewing && moving ? (
        <MovePhotoDialog
          photo={viewing}
          folders={folders.data?.folders ?? []}
          onClose={() => setMoving(false)}
          onMoved={(moved) => {
            cache.afterPhotoMove(moved, viewing.folderId);
            setMoving(false);
            setViewing(null);
            setNotice({
              text: `«${moved.title}» se movió a «${folderLabel(folders.data?.folders, moved.folderId)}».`,
              tone: 'info',
            });
          }}
          onConflict={showConflict}
          onSessionExpired={handleSessionExpired}
        />
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
            cache.afterPhotoChange(viewing.folderId);
          }}
        />
      ) : null}
      {renaming ? (
        <FolderFormDialog
          folder={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(saved) => {
            setRenaming(null);
            cache.afterFolderRenamed(saved);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {deletingFolder ? (
        <DeleteFolderDialog
          folder={deletingFolder}
          onCancel={() => setDeletingFolder(null)}
          onDeleted={() => {
            setDeletingFolder(null);
            navigate('/more/photos', { replace: true });
            cache.afterFolderDeleted(deletingFolder.id);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </div>
  );
}
