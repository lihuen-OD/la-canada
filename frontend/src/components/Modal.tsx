import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PropsWithChildren } from 'react';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps extends PropsWithChildren {
  titleId: string;
  onRequestClose: () => void;
  /** Mientras se envía una operación no debe poder cerrarse con Escape a mitad de camino. */
  closeDisabled?: boolean;
}

/**
 * Diálogo accesible genérico — foco inicial al primer elemento enfocable,
 * foco contenido (Tab/Shift+Tab no se escapa del panel), cierre con
 * Escape salvo mientras se está enviando. Reutilizado por `PinDialog` y
 * `ConfirmDialog` (activación, cambio de PIN, cambio de estado) para no
 * duplicar esta mecánica tres veces.
 */
export function Modal({ titleId, onRequestClose, closeDisabled, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    first?.focus();
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

  return (
    <div className="modal-overlay">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
