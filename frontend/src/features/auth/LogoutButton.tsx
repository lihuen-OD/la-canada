import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import type { ButtonVariant } from '../../components/ui/buttonStyles';
import { LogOutIcon } from '../../components/ui/icons';

interface LogoutButtonProps {
  variant?: ButtonVariant;
  /** Contenido del texto visible — el nombre accesible siempre incluye "Cerrar sesión". */
  label?: ReactNode;
  className?: string;
}

/**
 * Invoca el mismo `logout()` de siempre (`AuthProvider`) — no agrega ni
 * cambia lógica de sesión. Solo evita un segundo click mientras el primero
 * sigue en curso y muestra el estado de envío.
 */
export function LogoutButton({
  variant = 'secondary',
  label = 'Cerrar sesión',
  className,
}: LogoutButtonProps) {
  const { logout } = useAuth();
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);

  function handleClick(): void {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    void Promise.resolve(logout()).finally(() => {
      pendingRef.current = false;
      setIsPending(false);
    });
  }

  return (
    <Button
      variant={variant}
      className={className}
      icon={<LogOutIcon />}
      loading={isPending}
      onClick={handleClick}
    >
      {label}
    </Button>
  );
}
