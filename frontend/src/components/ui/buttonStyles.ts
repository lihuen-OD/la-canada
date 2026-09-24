export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * Clases del botón — compartidas con `Button` y usadas para estilizar un
 * `<Link>` de react-router como botón sin duplicar estilos ni anidar
 * `<button>` dentro de `<a>`. Todas las variantes respetan el alto táctil
 * mínimo de 44px.
 */
export function buttonClassName({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return [
    'button',
    `button--${variant}`,
    size === 'sm' ? 'button--sm' : null,
    fullWidth ? 'button--full' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
