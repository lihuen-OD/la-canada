import { useRef, useState } from 'react';
import type { GalleryPhoto } from '../../api/moreTypes';
import { Button } from '../../components/ui/Button';
import { PhotoUploadDialog } from './PhotoUploadDialog';
import { PHOTO_TYPES } from './moreLabels';

/**
 * «Subir foto»: botón compacto + selector de archivo + diálogo (el flujo de
 * subida de siempre). La carpeta llega preseleccionada desde una carpeta;
 * desde la pantalla principal o «Todas las fotos» hay que elegirla. Sin
 * almacenamiento configurado queda deshabilitado (la pantalla muestra el
 * aviso con `hintId`).
 */
export function PhotoUploadButton({
  storage,
  defaultFolderId,
  hintId,
  variant = 'primary',
  onUploaded,
  onSessionExpired,
}: {
  /** `undefined` mientras se carga: deshabilitado, sin aviso. */
  storage: 'configured' | 'unconfigured' | undefined;
  defaultFolderId: string | null;
  hintId?: string;
  variant?: 'primary' | 'secondary';
  onUploaded: (photo: GalleryPhoto) => void;
  onSessionExpired: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        disabled={storage !== 'configured'}
        aria-describedby={storage === 'unconfigured' ? hintId : undefined}
        onClick={() => inputRef.current?.click()}
      >
        <span aria-hidden="true">📷 </span>Subir foto
      </Button>
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
