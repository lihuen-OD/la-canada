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
  folderNameError,
  isMissingFolder,
  normalizeFolderName,
  photoCountLabel,
} from './photoFolders';
import { useMoreCache } from './useMoreCache';

/** Valor del selector sin carpeta elegida (un `<select>` no admite `null`). */
const NONE_VALUE = '';

/**
 * Selector «Carpeta» de subir y mover: SIEMPRE una carpeta vigente (no hay
 * opción «sin carpeta»). Sin elección, pide elegir. Si la elegida dejó de
 * existir, queda marcada como no disponible y hay que elegir otra (nunca
 * se cambia sola por otro destino).
 */
export function FolderSelect({
  id,
  value,
  folders,
  disabled,
  invalid,
  describedBy,
  onChange,
}: {
  id: string;
  value: string | null;
  folders: readonly PhotoFolder[];
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
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
        value={value ?? NONE_VALUE}
        disabled={disabled}
        required
        aria-invalid={missing || invalid || undefined}
        aria-describedby={describedBy}
        onChange={(change) => onChange(change.target.value || null)}
      >
        {missing && value !== null ? (
          <option value={value} disabled>
            — Ya no existe: elegí otra —
          </option>
        ) : null}
        {value === null ? (
          <option value={NONE_VALUE} disabled>
            {folders.length ? 'Elegí una carpeta' : 'Primero creá una carpeta'}
          </option>
        ) : null}
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * «＋ Nueva carpeta» dentro de subir o mover: crear la carpeta sin perder la
 * foto ni el formulario y dejarla elegida. Sin carpetas aparece abierta, con
 * la explicación. Sin `<form>` propio (vive dentro del diálogo): Enter crea.
 * Mismo contrato que «Crear carpeta» (`Idempotency-Key`, validación local).
 */
export function InlineFolderCreate({
  noFolders,
  disabled,
  onCreated,
  onSessionExpired,
}: {
  noFolders: boolean;
  disabled?: boolean;
  onCreated: (folder: PhotoFolder) => void;
  onSessionExpired: () => void;
}) {
  const inputId = useId();
  const { afterFolderCreated } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const open = expanded || noFolders;

  function create(): void {
    const normalized = normalizeFolderName(name);
    const invalid = folderNameError(normalized);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run(async () => {
      setError(null);
      try {
        const saved = await createPhotoFolder(
          normalized,
          intent.current.keyFor(intentFingerprint('photo-folder', { name: normalized })),
        );
        intent.current.discard();
        afterFolderCreated(saved.folder);
        setName('');
        setExpanded(false);
        onCreated(saved.folder);
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        if (errorCodeOf(caught) !== 'IDEMPOTENCY_RECORD_PENDING') intent.current.discard();
        setError(errorMessageOf(caught));
      }
    });
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="inline-folder__toggle"
        disabled={disabled}
        onClick={() => setExpanded(true)}
      >
        <span aria-hidden="true">＋ </span>Nueva carpeta
      </Button>
    );
  }
  return (
    <div className="inline-folder">
      {noFolders ? (
        <p className="inline-folder__intro">
          Todavía no hay carpetas. Creá la primera para guardar la foto.
        </p>
      ) : null}
      <label className="field__label" htmlFor={inputId}>
        Nombre de la carpeta nueva
      </label>
      <div className="inline-folder__row">
        <input
          id={inputId}
          className="field__input"
          maxLength={PHOTO_FOLDER_NAME_MAX}
          autoComplete="off"
          placeholder="Ej: Jardín de invierno"
          value={name}
          disabled={disabled || isSubmitting}
          aria-invalid={error ? true : undefined}
          onChange={(change) => setName(change.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              create();
            }
          }}
        />
        <Button size="sm" loading={isSubmitting} disabled={disabled} onClick={create}>
          Crear
        </Button>
        {noFolders ? null : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isSubmitting}
            onClick={() => {
              setExpanded(false);
              setError(null);
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
      {error ? (
        <div className="live-status live-status--start">
          <span role="alert">
            <AlertIcon size="sm" />
            {error}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** «⋯» de una carpeta: solo Renombrar/Eliminar si el backend los autoriza. */
export function FolderActionsMenu({
  folder,
  className,
  onRename,
  onDelete,
}: {
  folder: PhotoFolder;
  className?: string;
  onRename: () => void;
  onDelete: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <ActionsMenu
      label={`Acciones de la carpeta ${folder.name}`}
      triggerRef={triggerRef}
      className={className}
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
 * «Mover a carpeta» de UNA foto: destino precargado con su carpeta actual
 * (una foto por organizar no tiene: hay que elegir). Siempre a una carpeta;
 * se puede crear una ahí mismo. Envía la carpeta en la que se vio la foto;
 * si otra persona la movió, la pantalla informa el conflicto (no se pisa).
 * Si el destino dejó de existir, el selector lo marca y hay que elegir otro.
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
    if (target === null || missing || unchanged) return;
    const folderId = target;
    void run(async () => {
      setError(null);
      try {
        const result = await movePhoto(photo.id, {
          folderId,
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
        <InlineFolderCreate
          noFolders={folders.length === 0}
          disabled={isSubmitting}
          onCreated={(folder) => setTarget(folder.id)}
          onSessionExpired={onSessionExpired}
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
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={target === null || missing || unchanged}
          >
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
          ? `«${folder.name}» tiene ${photoCountLabel(folder.photoCount)}. Solo se eliminan carpetas vacías: primero mové sus fotos a otra carpeta.`
          : `Se eliminará la carpeta «${folder.name}». Está vacía: ninguna foto se borra.`
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
