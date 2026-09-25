import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps extends PropsWithChildren {
  titleId: string;
  descriptionId?: string;
  onRequestClose: () => void;
  /** Mientras se envía una operación no debe poder cerrarse con Escape a mitad de camino. */
  closeDisabled?: boolean;
  /** `viewer`: visor de fotos sobre fondo oscuro (docs/UI_CONTEXT.md, "Fotografías"). */
  variant?: 'default' | 'viewer';
}

/**
 * Diálogo accesible genérico — bottom sheet en móvil, centrado desde 600px
 * (solo CSS). Foco inicial al primer elemento enfocable, foco contenido
 * (Tab/Shift+Tab no se escapa del panel), cierre con Escape salvo mientras
 * se está enviando, y foco devuelto al elemento que lo abrió al cerrar.
 * No se cierra con un click en el overlay a propósito: un toque accidental
 * fuera del panel no debe descartar un PIN a medio escribir.
 *
 * Se renderiza en un portal sobre `document.body` para que ningún
 * contenedor (p. ej. las container queries del listado administrativo)
 * pueda recortarlo o volverse su bloque contenedor.
 */
export function Modal({
  titleId,
  descriptionId,
  onRequestClose,
  closeDisabled,
  variant = 'default',
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
    document.documentElement.classList.add('has-modal');

    return () => {
      document.documentElement.classList.remove('has-modal');
      // Si el disparador ya no existe (p. ej. el botón "Activar" desaparece
      // tras activar al usuario), no se fuerza el foco a ningún lado.
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (!closeDisabled) {
        event.stopPropagation();
        onRequestClose();
      }
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return createPortal(
    <div className={variant === 'viewer' ? 'modal-overlay modal-overlay--viewer' : 'modal-overlay'}>
      <div
        className={variant === 'viewer' ? 'modal modal--viewer' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={panelRef}
        onKeyDown={handleKeyDown}
      >
        <div className="modal__handle" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}
