import type { CSSProperties } from 'react';
import type { LoginOption } from '../../api/types';

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const NEUTRAL_FALLBACK_COLOR = '#8a8f8a';

/** Nunca confía ciegamente en `colorHex`: si no tiene forma de color hex válida, se usa un gris neutro. */
function resolveSafeColor(colorHex: string | null): string {
  return colorHex !== null && HEX_COLOR_PATTERN.test(colorHex) ? colorHex : NEUTRAL_FALLBACK_COLOR;
}

interface IdentityCardProps {
  option: LoginOption;
  onSelect: (option: LoginOption) => void;
}

export function IdentityCard({ option, onSelect }: IdentityCardProps) {
  const color = resolveSafeColor(option.colorHex);
  const isAdmin = option.role === 'ADMIN';

  return (
    <button
      type="button"
      className="identity-card"
      style={{ '--identity-card-color': color } as CSSProperties}
      onClick={() => onSelect(option)}
    >
      <span className="identity-card__avatar" aria-hidden="true">
        {option.displayName.charAt(0).toUpperCase()}
      </span>
      <span className="identity-card__name">{option.displayName}</span>
      {isAdmin ? (
        <span className="identity-card__badge" aria-label="Cuenta de administrador">
          Administrador
        </span>
      ) : null}
    </button>
  );
}
