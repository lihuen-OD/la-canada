import { useWakeNotice } from '../connectivity/useBackendAvailability';
import { BackendWakeScreen } from './BackendWakeScreen';
import { Brand } from './ui/Brand';
import { LoadingState } from './ui/StateMessage';

/**
 * Pantalla de carga estable mientras se intenta restaurar la sesión al
 * iniciar la app (`AuthProvider`: health → un único `POST /auth/refresh` →
 * `/auth/me`). Se muestra en vez del selector de login para no parpadear
 * "login → sesión restaurada" en cada recarga de alguien que ya tenía sesión
 * activa. Mismo fondo verde bosque que el login: si no había sesión, la
 * transición al selector no produce un salto de color.
 *
 * Etapa 5R: si el backend no respondió pasada la demora anti-parpadeo (Render
 * despertando, o sin Internet), muestra "Preparando La Cañada" en su lugar.
 * Con un backend rápido, el aviso nunca aparece.
 */
export function BootstrappingScreen() {
  const notice = useWakeNotice();
  if (notice.visible) return <BackendWakeScreen notice={notice} />;
  return (
    <main className="splash theme-inverse">
      <Brand as="h1" size="hero" />
      <LoadingState label="Restaurando tu sesión…" />
    </main>
  );
}
