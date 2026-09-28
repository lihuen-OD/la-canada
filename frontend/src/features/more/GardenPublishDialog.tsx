import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { publishGardenPlanVersion } from '../../api/moreApi';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { AlertIcon } from '../../components/ui/icons';
import { errorCodeOf, errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { GARDEN_PLAN_TYPES, MAX_GARDEN_PLAN_BYTES } from './moreLabels';

interface GardenPublishDialogProps {
  file: File;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}

/**
 * Estado de la vista previa. `ready` es el único que habilita "Publicar":
 * hasta que el navegador decodificó la imagen, el botón sigue deshabilitado.
 */
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * "Publicar nueva versión" (solo ADMIN). No hay título ni notas: una versión
 * es exactamente el plano que se sube, con su número y su fecha. El backend
 * valida los bytes y el tamaño, y el mismo envío repetido no publica dos
 * versiones.
 */
export function GardenPublishDialog({
  file,
  onClose,
  onSaved,
  onSessionExpired,
}: GardenPublishDialogProps) {
  const formId = useId();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const valid = GARDEN_PLAN_TYPES.includes(file.type) && file.size <= MAX_GARDEN_PLAN_BYTES;
  const [error, setError] = useState<string | null>(() => {
    if (!GARDEN_PLAN_TYPES.includes(file.type)) return 'El plano debe ser JPG, PNG o WebP.';
    if (file.size > MAX_GARDEN_PLAN_BYTES) return 'El plano no puede superar 10 MB.';
    return null;
  });

  /**
   * El object URL se crea DENTRO del efecto y se guarda en estado, nunca en
   * `useMemo`. La URL anterior vivía en el memo: el cleanup del efecto la
   * revocaba, y en StrictMode el segundo montaje lógico reutilizaba esa URL
   * ya revocada (el memo no se recalcula) → ícono de imagen rota.
   *
   * Con la URL en estado, cada setup posterior al cleanup genera una URL nueva
   * y el `<img>` solo se monta cuando existe una viva. La revocación es del
   * `url` que creó ese mismo setup, así que un cleanup tardío nunca deja el
   * `<img>` apuntando a una URL revocada.
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  /**
   * URL viva según el último setup. Los eventos `load`/`error` del navegador
   * llegan de forma asíncrona: el `error` de una URL ya revocada llegaría
   * DESPUÉS de que el setup siguiente creara otra, y sin esta comparación
   * desactivaría la preview nueva. Solo se atiende el evento de la URL vigente.
   */
  const liveUrl = useRef<string | null>(null);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       El object URL es un recurso del efecto: se crea en el setup y se revoca en
       el cleanup, así que su estado solo puede existir después del setup. Es
       justamente lo que la regla quiere evitar (un render en cascada por estado
       derivable), pero aquí el valor NO es derivable del render: crearlo en
       `useMemo` o en el manejador del input lo deja revocado por el segundo
       montaje lógico de `StrictMode` (ícono de imagen rota, reproducido en
       Chrome). El ref evita el segundo render en cascada al cambiar de archivo. */
    if (!valid) {
      liveUrl.current = null;
      setPreviewUrl(null);
      setPreviewState('idle');
      return;
    }
    if (typeof URL.createObjectURL !== 'function') {
      liveUrl.current = null;
      setPreviewUrl(null);
      setPreviewState('error');
      return;
    }
    const url = URL.createObjectURL(file);
    liveUrl.current = url;
    setPreviewUrl(url);
    setPreviewState('loading');
    return () => {
      URL.revokeObjectURL(url);
      if (liveUrl.current === url) liveUrl.current = null;
      // Al cambiar de archivo o al desmontar, la URL revocada no puede quedar
      // en estado: el `<img>` dejaría de renderizarse y "Publicar" se bloquea.
      setPreviewUrl((current) => (current === url ? null : current));
      setPreviewState((current) => (current === 'error' ? current : 'idle'));
    };
  }, [file, valid]);

  const previewReady = previewState === 'ready' && previewUrl !== null;
  /** Ignora el evento si proviene de un `src` que ya no es el vigente. */
  function isLiveEvent(event: React.SyntheticEvent<HTMLImageElement>): boolean {
    return event.currentTarget.getAttribute('src') === liveUrl.current;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Guarda de defense en profundidad: el botón ya está deshabilitado, pero un
    // submit programático (Enter) no debe publicar sin preview cargada.
    if (!valid || !previewReady) return;
    // Solo el archivo define la huella: dos imágenes distintas con la misma
    // clave dan 409 en vez de publicar dos versiones.
    const fingerprint = intentFingerprint(`garden-plan:${file.name}`, {
      size: file.size,
      lastModified: file.lastModified,
    });
    void run(async () => {
      setError(null);
      try {
        await publishGardenPlanVersion(file, intent.current.keyFor(fingerprint));
        intent.current.discard();
        onSaved();
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

  return (
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          Publicar nueva versión
        </h2>
        <p className="dialog__description">
          La versión anterior se conserva en el historial. Publicar no borra ni reemplaza nada.
        </p>
        {previewUrl && previewState !== 'error' ? (
          <img
            className="upload-preview"
            src={previewUrl}
            alt="Vista previa del plano elegido"
            onLoad={(event) => {
              if (!isLiveEvent(event)) return;
              setPreviewState('ready');
            }}
            onError={(event) => {
              if (!isLiveEvent(event)) return;
              setPreviewUrl(null);
              setPreviewState('error');
              setError('No pudimos generar la vista previa. Volvé a seleccionar la imagen.');
            }}
          />
        ) : null}
        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Publicando…</span> : null}
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
          <Button type="submit" loading={isSubmitting} disabled={!valid || !previewReady}>
            Publicar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
