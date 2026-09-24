import type { LoginOption } from '../../api/types';
import { getRoleLabel } from '../../auth/userDisplay';
import { Avatar } from '../../components/ui/Avatar';
import { ChevronRightIcon } from '../../components/ui/icons';

interface IdentityCardProps {
  option: LoginOption;
  onSelect: (option: LoginOption) => void;
}

/**
 * Una fila por identidad activa. El administrador se distingue con escudo
 * en vez de inicial, una etiqueta visible y un texto accesible explícito —
 * nunca solo por color. `colorHex` se valida en `Avatar` (fallback neutro).
 */
export function IdentityCard({ option, onSelect }: IdentityCardProps) {
  const isAdmin = option.role === 'ADMIN';
  // Un ADMIN sin persona vinculada ya llega con el nombre genérico
  // "Administrador": la etiqueta visible sería redundante. El nombre
  // accesible explícito se mantiene siempre y empieza por el texto visible
  // (WCAG 2.5.3, "label in name").
  const showVisibleBadge = isAdmin && option.displayName !== getRoleLabel('ADMIN');

  return (
    <button
      type="button"
      className="identity-option"
      aria-label={isAdmin ? `${option.displayName}, cuenta de administrador` : undefined}
      onClick={() => onSelect(option)}
    >
      <Avatar
        name={option.displayName}
        colorHex={option.colorHex}
        variant={isAdmin ? 'admin' : 'person'}
      />
      <span className="identity-option__text">
        <span className="identity-option__name">{option.displayName}</span>
        {showVisibleBadge ? (
          <span className="badge identity-option__badge" aria-hidden="true">
            {getRoleLabel('ADMIN')}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="identity-option__chevron" />
    </button>
  );
}
