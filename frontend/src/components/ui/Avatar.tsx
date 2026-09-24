import type { CSSProperties } from 'react';
import { resolveSafeColor } from '../../utils/color';
import { ShieldIcon } from './icons';

interface AvatarProps {
  name: string;
  colorHex?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /** `admin`: cuenta administrativa sin persona vinculada — escudo en tono tierra en vez de inicial. */
  variant?: 'person' | 'admin';
}

/**
 * Siempre decorativo (`aria-hidden`): el nombre de la persona se muestra
 * como texto al lado — nunca se identifica a nadie solo por color o inicial.
 */
export function Avatar({ name, colorHex, size = 'md', variant = 'person' }: AvatarProps) {
  const classes = ['avatar', size === 'md' ? null : `avatar--${size}`];

  if (variant === 'admin') {
    return (
      <span className={[...classes, 'avatar--admin'].filter(Boolean).join(' ')} aria-hidden="true">
        <ShieldIcon size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'} />
      </span>
    );
  }

  return (
    <span
      className={classes.filter(Boolean).join(' ')}
      style={{ '--avatar-color': resolveSafeColor(colorHex) } as CSSProperties}
      data-avatar=""
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
