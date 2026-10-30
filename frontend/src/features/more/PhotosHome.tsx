import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GalleryPhoto, PhotoFolder } from '../../api/moreTypes';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { DeleteFolderDialog, FolderActionsMenu, FolderFormDialog } from './PhotoFolderDialogs';
import { PhotoUploadZone } from './PhotoUploadZone';
import {
  ALL_PHOTOS_ICON,
  ALL_PHOTOS_LABEL,
  FOLDER_ICON,
  UNFILED_ICON,
  UNFILED_LABEL,
  folderLabel,
  photoCountLabel,
  photoScopePath,
  usePhotoFolders,
} from './photoFolders';
import { useMoreCache } from './useMoreCache';

/** Tarjeta de carpeta (o de un acceso especial): ícono, nombre y cantidad de fotos visibles. */
function FolderCard({
  to,
  icon,
  name,
  count,
  special = false,
  menu,
}: {
  to: string;
  icon: string;
  name: string;
  count: number;
  special?: boolean;
  menu?: ReactNode;
}) {
  return (
    <div className={`photo-folder${special ? ' photo-folder--special' : ''}`}>
      <Link to={to} className="photo-folder__link">
        <span className="photo-folder__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="photo-folder__name">{name}</span>
        <span className="photo-folder__count">{photoCountLabel(count)}</span>
      </Link>
      {menu}
    </div>
  );
}

/**
 * 📸 Fotos — pantalla principal: galería compartida organizada en carpetas
 * de un nivel. «Todas las fotos» y «Sin carpeta» son accesos especiales (no
 * se editan ni se eliminan); las carpetas, en orden por nombre, con sus
 * conteos — todo en UNA request. Cualquiera crea carpetas y sube fotos;
 * renombrar o eliminar, quien la creó o un ADMIN (lo dice el backend).
 */
export default function PhotosHome() {
  const { logout } = useAuth();
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const folders = usePhotoFolders();
  const cache = useMoreCache();
  const sectionId = useId();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<PhotoFolder | null>(null);
  const [deleting, setDeleting] = useState<PhotoFolder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const expired = isSessionExpired(folders.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  const data = folders.data;

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📸 </span>Fotos
          </>
        }
        refreshing={Boolean(data) && folders.isFetching}
        actions={<MoreBackLink />}
      />
      <PhotoUploadZone
        storage={data?.photoStorage}
        defaultFolderId={null}
        onUploaded={(photo: GalleryPhoto) => {
          cache.afterPhotoChange(photo.folderId);
          setNotice(`La foto se guardó en «${folderLabel(data?.folders, photo.folderId)}».`);
        }}
        onSessionExpired={handleSessionExpired}
      />

      <section className="photo-folders-section" aria-labelledby={sectionId}>
        <div className="photo-folders-section__head">
          <h2 id={sectionId} className="more__section-title">
            Carpetas
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            <span aria-hidden="true">＋ </span>Nueva carpeta
          </Button>
        </div>
        <p className="photo-folders-section__notice" role="status" aria-live="polite">
          {notice}
        </p>
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
        ) : (
          <>
            <ul className="photo-folders" aria-label="Carpetas de fotos">
              <li>
                <FolderCard
                  to={photoScopePath('all')}
                  icon={ALL_PHOTOS_ICON}
                  name={ALL_PHOTOS_LABEL}
                  count={data.all.photoCount}
                  special
                />
              </li>
              <li>
                <FolderCard
                  to={photoScopePath('none')}
                  icon={UNFILED_ICON}
                  name={UNFILED_LABEL}
                  count={data.unfiled.photoCount}
                  special
                />
              </li>
              {data.folders.map((folder) => (
                <li key={folder.id}>
                  <FolderCard
                    to={photoScopePath(folder.id)}
                    icon={FOLDER_ICON}
                    name={folder.name}
                    count={folder.photoCount}
                    menu={
                      <FolderActionsMenu
                        folder={folder}
                        onRename={() => setRenaming(folder)}
                        onDelete={() => setDeleting(folder)}
                      />
                    }
                  />
                </li>
              ))}
            </ul>
            {data.folders.length === 0 ? (
              <p className="more__muted">
                Todavía no hay carpetas. Creá la primera con «Nueva carpeta»: las fotos sin carpeta
                siguen en «Sin carpeta».
              </p>
            ) : null}
          </>
        )}
      </section>

      {creating ? (
        <FolderFormDialog
          onClose={() => setCreating(false)}
          onSaved={(folder) => {
            setCreating(false);
            cache.afterFolderCreated();
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
