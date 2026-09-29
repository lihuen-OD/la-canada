import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLoginOptions } from '../../api/authApi';
import type { LoginOption } from '../../api/types';
import { BackendWakeNotice } from '../../components/BackendWakeScreen';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { useWakeNotice } from '../../connectivity/useBackendAvailability';
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
 * reemplaza por fixtures ni ofrece ningún botón (el primer administrador
 * se crea fuera del navegador).
 */
export function IdentitySelector({ onSelect }: IdentitySelectorProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const wake = useWakeNotice();
  const startedRef = useRef(false);

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

  // Una sola carga por montaje, también bajo StrictMode (el ref sobrevive al
  // doble efecto de desarrollo): nunca dos `GET /auth/login-options`.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    fetchOptions();
  }, [fetchOptions]);

  if (state.status === 'loading') {
    // Etapa 5R: con el backend despertando, la request espera sola en
    // `httpClient` y las identidades aparecen cuando responde — mientras
    // tanto, "Preparando La Cañada" en lugar de un error técnico.
    return wake.visible ? <BackendWakeNotice /> : <LoadingState label="Cargando identidades…" />;
  }

  if (state.status === 'error') {
    return <ErrorState title="No pudimos cargar las identidades habilitadas." onRetry={retry} />;
  }

  if (state.options.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay usuarios habilitados para ingresar."
        description="El administrador debe crear su acceso inicial y habilitar a los integrantes del equipo."
      />
    );
  }

  return (
    // `role="list"` explícito: Safari/VoiceOver descarta la semántica de
    // lista en un <ul> con `list-style: none`.
    <ul className="identity-list" role="list" aria-label="Identidades habilitadas">
      {state.options.map((option) => (
        <li key={option.id}>
          <IdentityCard option={option} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}
