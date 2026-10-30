import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import {
  createPhotoFolder,
  deletePhotoFolder,
  movePhoto,
  renamePhotoFolder,
} from '../../api/moreApi';
import type { GalleryPhoto, PhotoFolder } from '../../api/moreTypes';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { ActionsMenu } from './ActionsMenu';
import {
  PHOTO_FOLDER_NAME_MAX,
  UNFILED_LABEL,
  folderNameError,
  isMissingFolder,
  normalizeFolderName,
  photoCountLabel,
} from './photoFolders';
import { useMoreCache } from './useMoreCache';

/** Valor del selector para «Sin carpeta» (un `<select>` no admite `null`). */
const UNFILED_VALUE = '';

/**
 * Selector «Carpeta» de subir y mover: «Sin carpeta» + carpetas vigentes en
 * orden. Si la elegida dejó de existir, queda marcada como no disponible y
 * quien la eligió debe elegir otra (nunca se cambia sola por otro destino).
 */
export function FolderSelect({
  id,
  value,
  folders,
  disabled,
  onChange,
}: {
  id: string;
  value: string | null;
  folders: readonly PhotoFolder[];
  disabled?: boolean;
  onChange: (folderId: string | null) => void;
}) {
  const missing = isMissingFolder(value, folders);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Carpeta
      </label>
      <select
        id={id}
        className="field__input"
        value={value ?? UNFILED_VALUE}
        disabled={disabled}
        aria-invalid={missing || undefined}
        onChange={(change) => onChange(change.target.value || null)}
      >
        {missing && value !== null ? (
          <option value={value} disabled>
            — Ya no existe: elegí otra —
          </option>
        ) : null}
        <option value={UNFILED_VALUE}>{UNFILED_LABEL}</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** «⋯» de una carpeta: solo Renombrar/Eliminar si el backend los autoriza. */
export function FolderActionsMenu({
  folder,
  onRename,
  onDelete,
}: {
  folder: PhotoFolder;
  onRename: () => void;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <ActionsMenu
      label={`Acciones de la carpeta ${folder.name}`}
      triggerRef={triggerRef}
      className="photo-folder__menu"
      items={[
        ...(folder.permissions.canRename
          ? [{ key: 'rename', label: 'Renombrar', onSelect: onRename }]
          : []),
        ...(folder.permissions.canDelete
          ? [{ key: 'delete', label: 'Eliminar', danger: true, onSelect: onDelete }]
          : []),
      ]}
    />
  );
}

/**
 * «Nueva carpeta» o «Renombrar». El nombre se normaliza como en el backend
 * (que vuelve a validar). Crear usa `Idempotency-Key` (un doble clic o un
 * reintento del mismo nombre no crea dos); renombrar envía la versión vista
 * al abrir: si otra persona la cambió, 409 y el formulario queda como está.
 * Guardar el mismo nombre no envía nada.
 */
export function FolderFormDialog({
  folder,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  /** Ausente = crear. */
  folder?: PhotoFolder;
  onClose: () => void;
  onSaved: (folder: PhotoFolder) => void;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { refreshPhotoFolders } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const [version] = useState(folder?.version ?? 1);
  const [name, setName] = useState(folder?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const normalized = normalizeFolderName(name);
    const invalid = folderNameError(normalized);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (folder && normalized === folder.name) {
      onClose();
      return;
    }
    void run(async () => {
      setError(null);
      try {
        const saved = folder
          ? await renamePhotoFolder(folder.id, { name: normalized, version })
          : await createPhotoFolder(
              normalized,
              intent.current.keyFor(intentFingerprint('photo-folder', { name: normalized })),
            );
        intent.current.discard();
        onSaved(saved.folder);
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        const code = errorCodeOf(caught);
        if (code !== 'IDEMPOTENCY_RECORD_PENDING') intent.current.discard();
        if (code === 'PHOTO_FOLDER_VERSION_CONFLICT' || code === 'PHOTO_FOLDER_NOT_FOUND') {
          refreshPhotoFolders();
        }
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          {folder ? 'Renombrar carpeta' : 'Nueva carpeta'}
        </h2>
        <div className="field">
          <label className="field__label" htmlFor={`${formId}-name`}>
            Nombre
          </label>
          <input
            id={`${formId}-name`}
            className="field__input"
            maxLength={PHOTO_FOLDER_NAME_MAX}
            autoComplete="off"
            placeholder="Ej: Jardín de invierno"
            value={name}
            disabled={isSubmitting}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${formId}-status`}
            onChange={(change) => setName(change.target.value)}
          />
        </div>
        <div
          id={`${formId}-status`}
          aria-live="assertive"
          className="live-status live-status--start"
        >
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
        </div>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {folder ? 'Guardar' : 'Crear carpeta'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * «Mover a carpeta» de UNA foto: destino precargado con su carpeta actual.
 * Envía la carpeta en la que se vio la foto; si otra persona la movió, la
 * pantalla informa el conflicto (no se pisa). Si el destino dejó de existir,
 * el selector lo marca y hay que elegir otro.
 */
export function MovePhotoDialog({
  photo,
  folders,
  onClose,
  onMoved,
  onConflict,
  onSessionExpired,
}: {
  photo: GalleryPhoto;
  folders: readonly PhotoFolder[];
  onClose: () => void;
  onMoved: (photo: GalleryPhoto) => void;
  onConflict: (message: string) => void;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { refreshPhotoFolders } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [target, setTarget] = useState<string | null>(photo.folderId);
  const [error, setError] = useState<string | null>(null);
  const missing = isMissingFolder(target, folders);
  const unchanged = target === photo.folderId;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (missing || unchanged) return;
    void run(async () => {
      setError(null);
      try {
        const result = await movePhoto(photo.id, {
          folderId: target,
          fromFolderId: photo.folderId,
        });
        onMoved(result.photo);
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        const code = errorCodeOf(caught);
        if (code === 'PHOTO_MOVE_CONFLICT' || code === 'PHOTO_NOT_FOUND') {
          onConflict(errorMessageOf(caught));
          return;
        }
        if (code === 'PHOTO_FOLDER_UNAVAILABLE') refreshPhotoFolders();
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          Mover a carpeta
        </h2>
        <p className="more__muted photo-move__title">«{photo.title}»</p>
        <FolderSelect
          id={`${formId}-folder`}
          value={target}
          folders={folders}
          disabled={isSubmitting}
          onChange={setTarget}
        />
        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Moviendo…</span> : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
        </div>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={missing || unchanged}>
            Mover
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Confirmación explícita. Solo se elimina vacía: las fotos nunca se borran
 * ni se mueven solas. Si el backend la encuentra con fotos o cambiada, el
 * mensaje queda en el diálogo y se actualiza el listado.
 */
export function DeleteFolderDialog({
  folder,
  onCancel,
  onDeleted,
  onSessionExpired,
}: {
  folder: PhotoFolder;
  onCancel: () => void;
  onDeleted: () => void;
  onSessionExpired: () => void;
}) {
  const { refreshPhotoFolders } = useMoreCache();
  return (
    <ConfirmDialog
      title="¿Eliminar la carpeta?"
      description={
        folder.photoCount > 0
          ? `«${folder.name}» tiene ${photoCountLabel(folder.photoCount)}. Solo se eliminan carpetas vacías: primero mové sus fotos a otra carpeta o a «Sin carpeta».`
          : `Se eliminará la carpeta «${folder.name}». Las fotos nunca se borran.`
      }
      confirmLabel="Eliminar"
      tone="danger"
      onCancel={onCancel}
      onConfirm={async () => {
        try {
          await deletePhotoFolder(folder.id, folder.version);
        } catch (caught) {
          if (isSessionExpired(caught)) return onSessionExpired();
          const code = errorCodeOf(caught);
          if (code === 'PHOTO_FOLDER_NOT_FOUND') {
            onDeleted();
            return;
          }
          if (code === 'PHOTO_FOLDER_NOT_EMPTY' || code === 'PHOTO_FOLDER_VERSION_CONFLICT') {
            refreshPhotoFolders(folder.id);
          }
          throw humanError(caught);
        }
        onDeleted();
      }}
    />
  );
}
