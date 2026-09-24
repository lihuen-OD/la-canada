import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClassName } from './buttonStyles';
import type { ButtonStyleOptions } from './buttonStyles';
import { Spinner } from './Spinner';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleOptions {
  /** Operación en curso: deshabilita el botón y muestra un spinner, sin cambiar su nombre accesible. */
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  loading = false,
  icon,
  disabled,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : icon ? (
        <span className="button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
