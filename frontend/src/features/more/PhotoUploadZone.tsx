import { useId, useRef, useState } from 'react';
import type { GalleryPhoto } from '../../api/moreTypes';
import { PhotoUploadDialog } from './PhotoUploadDialog';
import { PHOTO_TYPES } from './moreLabels';

/**
 * "Subir foto" de siempre (zona punteada + selector de archivo + diálogo),
 * en la pantalla principal y dentro de cada parte de la galería. Sin
 * almacenamiento configurado queda deshabilitada con el aviso de siempre.
 */
export function PhotoUploadZone({
  storage,
  defaultFolderId,
  onUploaded,
  onSessionExpired,
}: {
  /** `undefined` mientras se carga: deshabilitada, sin aviso. */
  storage: 'configured' | 'unconfigured' | undefined;
  defaultFolderId: string | null;
  onUploaded: (photo: GalleryPhoto) => void;
  onSessionExpired: () => void;
}) {
  const hintId = useId();
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ready = storage === 'configured';
  return (
    <>
      <button
        type="button"
        className="upload-zone"
        disabled={!ready}
        onClick={() => inputRef.current?.click()}
        aria-describedby={storage === 'unconfigured' ? hintId : undefined}
      >
        <span className="upload-zone__icon" aria-hidden="true">
          📷
        </span>
        <span className="upload-zone__title">Subir foto</span>
        <span className="upload-zone__hint">Tocá para seleccionar</span>
      </button>
      {storage === 'unconfigured' ? (
        <p id={hintId} className="notice notice--warning">
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
      {file ? (
        <PhotoUploadDialog
          file={file}
          defaultFolderId={defaultFolderId}
          onClose={() => setFile(null)}
          onSaved={(photo) => {
            setFile(null);
            onUploaded(photo);
          }}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
    </>
  );
}
