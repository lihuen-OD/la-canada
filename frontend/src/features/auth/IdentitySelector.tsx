import { useCallback, useEffect, useState } from 'react';
import { fetchLoginOptions } from '../../api/authApi';
import type { LoginOption } from '../../api/types';
import { IdentityCard } from './IdentityCard';

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'loaded'; options: LoginOption[] };

interface IdentitySelectorProps {
  onSelect: (option: LoginOption) => void;
}

/**
 * Consume `GET /auth/login-options` tal cual — la respuesta real viene
 * envuelta en `{ options: [...] }`, nunca un array suelto (ver
 * `backend/src/controllers/authController.ts`). Nunca inventa personas ni
 * completa la lista con datos de relleno: una lista vacía es un estado
 * real (todavía no hay nadie activado) y se muestra como tal, no se
 * reemplaza por fixtures.
 */
export function IdentitySelector({ onSelect }: IdentitySelectorProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // Sin `setState` síncrono en el cuerpo del efecto (el estado inicial ya
  // es `loading`) — el efecto solo dispara el fetch; `setState` corre
  // siempre dentro de un callback async (`.then`/`.catch`), nunca síncrono.
  const fetchOptions = useCallback(() => {
    fetchLoginOptions()
      .then((response) => setState({ status: 'loaded', options: response.options }))
      .catch(() => setState({ status: 'error' }));
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    fetchOptions();
  }, [fetchOptions]);

  useEffect(() => {
    fetchOptions();
  }, [fetchOptions]);

  if (state.status === 'loading') {
    return (
      <p className="identity-selector__message" role="status" aria-live="polite">
        Cargando identidades…
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="identity-selector__message" role="alert">
        <p>No pudimos cargar las identidades habilitadas.</p>
        <button type="button" className="button button--primary" onClick={retry}>
          Reintentar
        </button>
      </div>
    );
  }

  if (state.options.length === 0) {
    return (
      <div className="identity-selector__message">
        <p>Todavía no hay usuarios habilitados para ingresar.</p>
        <p className="identity-selector__hint">
          El administrador debe crear su acceso inicial y habilitar a los integrantes del equipo.
        </p>
      </div>
    );
  }

  return (
    <div className="identity-selector__grid" role="list">
      {state.options.map((option) => (
        <div role="listitem" key={option.id}>
          <IdentityCard option={option} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
