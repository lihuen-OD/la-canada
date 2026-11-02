import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GalleryPhoto, PhotoFolder } from '../../api/moreTypes';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { DeleteFolderDialog, FolderActionsMenu, FolderFormDialog } from './PhotoFolderDialogs';
import { PhotoUploadButton } from './PhotoUploadButton';
import {
  ALL_PHOTOS_LABEL,
  FOLDER_ICON,
  TO_ORGANIZE_ICON,
  folderLabel,
  photoCountLabel,
  photoScopePath,
  usePhotoFolders,
} from './photoFolders';
import { useMoreCache } from './useMoreCache';

/**
 * Tarjeta de carpeta: ícono, nombre (hasta dos líneas) y cantidad de fotos
 * visibles. Sin vista previa a propósito: el backend no genera miniaturas y
 * una portada costaría descargar la imagen completa (hasta 10 MB) por
 * carpeta. El «⋯» queda fuera del enlace (no se anidan controles) y solo
 * aparece con acciones autorizadas.
 */
function FolderCard({
  folder,
  onRename,
  onDelete,
}: {
  folder: PhotoFolder;
  onRename: () => void;
  onDelete: () => void;
}) {
  const hasActions = folder.permissions.canRename || folder.permissions.canDelete;
  return (
    <div className={`photo-folder${hasActions ? ' photo-folder--with-menu' : ''}`}>
      <Link to={photoScopePath(folder.id)} className="photo-folder__link">
        <span className="photo-folder__icon" aria-hidden="true">
          {FOLDER_ICON}
        </span>
        <span className="photo-folder__text">
          <span className="photo-folder__name">{folder.name}</span>
          <span className="photo-folder__count">{photoCountLabel(folder.photoCount)}</span>
        </span>
      </Link>
      <FolderActionsMenu
        folder={folder}
        className="photo-folder__menu"
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * 📸 Fotos — pantalla principal: galería compartida organizada en carpetas
 * de un nivel. Encabezado con «Crear carpeta» y «Subir foto»; grilla de
 * carpetas por nombre con sus conteos; «Todas las fotos» como acceso
 * secundario y, solo si quedan fotos anteriores sin carpeta, el acceso
 * discreto «Fotos por organizar». Todo en UNA request. Cualquiera crea
 * carpetas y sube fotos (siempre a una carpeta); renombrar o eliminar,
 * quien la creó o un ADMIN (lo dice el backend).
 */
export default function PhotosHome() {
  const { logout } = useAuth();
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const folders = usePhotoFolders();
  const cache = useMoreCache();
  const sectionId = useId();
  const storageHintId = useId();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<PhotoFolder | null>(null);
  const [deleting, setDeleting] = useState<PhotoFolder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expired = isSessionExpired(folders.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  const data = folders.data;
  const toOrganize = data?.unfiled.photoCount ?? 0;

  return (
    <div className="more photos">
      <div className="photos__back">
        <MoreBackLink label="Más" />
      </div>
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📸 </span>Fotos
          </>
        }
        description="Las fotos de La Cañada, organizadas en carpetas compartidas."
        refreshing={Boolean(data) && folders.isFetching}
        actions={
          <div className="photos__actions">
            <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
              <span aria-hidden="true">＋ </span>Crear carpeta
            </Button>
            <PhotoUploadButton
              storage={data?.photoStorage}
              defaultFolderId={null}
              hintId={storageHintId}
              onUploaded={(photo: GalleryPhoto) => {
                cache.afterPhotoChange(photo.folderId);
                setNotice(`La foto se guardó en «${folderLabel(data?.folders, photo.folderId)}».`);
              }}
              onSessionExpired={handleSessionExpired}
            />
          </div>
        }
      />
      {data?.photoStorage === 'unconfigured' ? (
        <p id={storageHintId} className="notice notice--warning">
          Las fotos no están disponibles: falta configurar el almacenamiento.
        </p>
      ) : null}
      <p className="photos__notice" role="status" aria-live="polite">
        {notice}
      </p>

      {toOrganize > 0 ? (
        <Link to={photoScopePath('none')} className="photos-organize">
          <span className="photos-organize__icon" aria-hidden="true">
            {TO_ORGANIZE_ICON}
          </span>
          <span className="photos-organize__text">
            <strong>
              {toOrganize === 1 ? '1 foto por organizar' : `${toOrganize} fotos por organizar`}
            </strong>
            <span>Son anteriores a las carpetas: movelas a la que corresponda.</span>
          </span>
          <span className="photos-organize__go" aria-hidden="true">
            →
          </span>
        </Link>
      ) : null}

      <section className="photos__section" aria-labelledby={sectionId}>
        <div className="photos__section-head">
          <h2 id={sectionId} className="more__section-title">
            Carpetas
            {data && data.folders.length > 0 ? (
              <span className="photos__section-count"> · {data.folders.length}</span>
            ) : null}
          </h2>
          {data && data.all.photoCount > 0 ? (
            <Link to={photoScopePath('all')} className="photos__all-link">
              Ver {ALL_PHOTOS_LABEL.toLowerCase()} ({data.all.photoCount})
            </Link>
          ) : null}
        </div>
        {!data ? (
          folders.isError ? (
            <ErrorState
              title="No pudimos cargar las carpetas"
              description={errorMessageOf(folders.error)}
              onRetry={() => void folders.refetch()}
            />
          ) : (
            <LoadingState label="Cargando carpetas…" />
          )
        ) : data.folders.length === 0 ? (
          <div className="photos-empty">
            <span className="photos-empty__icon" aria-hidden="true">
              {FOLDER_ICON}
            </span>
            <p className="photos-empty__title">Todavía no hay carpetas</p>
            <p className="photos-empty__text">
              Creá la primera carpeta para empezar a subir y organizar fotos.
            </p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <span aria-hidden="true">＋ </span>Crear la primera carpeta
            </Button>
          </div>
        ) : (
          <ul className="photo-folders" aria-label="Carpetas de fotos">
            {data.folders.map((folder) => (
              <li key={folder.id}>
                <FolderCard
                  folder={folder}
                  onRename={() => setRenaming(folder)}
                  onDelete={() => setDeleting(folder)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {creating ? (
        <FolderFormDialog
          onClose={() => setCreating(false)}
          onSaved={(folder) => {
            setCreating(false);
            cache.afterFolderCreated(folder);
            setNotice(`Se creó la carpeta «${folder.name}».`);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {renaming ? (
        <FolderFormDialog
          folder={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(folder) => {
            setRenaming(null);
            cache.afterFolderRenamed(folder);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {deleting ? (
        <DeleteFolderDialog
          folder={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={() => {
            cache.afterFolderDeleted(deleting.id);
            setNotice(`Se eliminó la carpeta «${deleting.name}».`);
            setDeleting(null);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </div>
  );
}
