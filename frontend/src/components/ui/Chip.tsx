import type { ReactNode } from 'react';

interface ChipProps {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Contenido previo al texto (avatar, emoji decorativo). */
  leading?: ReactNode;
  /** Cantidad auxiliar (p. ej. pendientes), visible como burbuja. */
  count?: number;
  /**
   * Nombre accesible explícito cuando hay `count` (p. ej. "Coke, 2
   * pendientes"): debe empezar por el texto visible (WCAG 2.5.3).
   */
  accessibleLabel?: string;
}

/**
 * Chip de filtro en forma de píldora (docs/UI_CONTEXT.md, "Chips"):
 * inactivo blanco con borde cálido, activo verde con texto blanco. Botón
 * con `aria-pressed` — el estado nunca depende solo del color.
 */
export function Chip({ selected, onSelect, children, leading, count, accessibleLabel }: ChipProps) {
  return (
    <button
      type="button"
      className={selected ? 'chip chip--selected' : 'chip'}
      aria-pressed={selected}
      aria-label={accessibleLabel}
      onClick={onSelect}
    >
      {leading}
      <span>{children}</span>
      {count !== undefined ? (
        <span className="chip__count" aria-hidden={accessibleLabel ? true : undefined}>
          {count}
        </span>
      ) : null}
    </button>
  );
}
