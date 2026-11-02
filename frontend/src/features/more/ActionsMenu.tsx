import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { buttonClassName } from '../../components/ui/buttonStyles';

export interface ActionsMenuItem {
  key: string;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Menú «⋯» (patrón de menú de botones) de ☰ Más: solo con las acciones que
 * autoriza el backend; sin ninguna, no se muestra. Flechas, Inicio/Fin y
 * Escape; al cerrarlo el foco vuelve al disparador (también antes de abrir
 * una confirmación, para que Cancelar devuelva el foco acá).
 */
export function ActionsMenu({
  label,
  items,
  triggerRef,
  className,
}: {
  label: string;
  items: readonly ActionsMenuItem[];
  triggerRef: RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function closeOnOutsidePointer(event: PointerEvent): void {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open, triggerRef]);

  if (items.length === 0) return null;

  function close(): void {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const elements = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const current = elements.findIndex((item) => item === document.activeElement);
    const focusAt = (index: number) => {
      event.preventDefault();
      elements[(index + elements.length) % elements.length]?.focus();
    };
    if (event.key === 'ArrowDown') focusAt(current + 1);
    else if (event.key === 'ArrowUp') focusAt(current - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(elements.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') setOpen(false);
  }

  return (
    <div className={['news-menu', className].filter(Boolean).join(' ')}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClassName({
          variant: 'ghost',
          size: 'sm',
          className: 'news-menu__trigger',
        })}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          className="news-menu__list"
          onKeyDown={handleKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`news-menu__item${item.danger ? ' news-menu__item--danger' : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
