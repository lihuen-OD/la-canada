import { Brand } from './ui/Brand';
import { LoadingState } from './ui/StateMessage';

/**
 * Pantalla de carga estable mientras se intenta restaurar la sesión al
 * iniciar la app (`AuthProvider`, un único `POST /auth/refresh`). Se
 * muestra en vez del selector de login para no parpadear "login → sesión
 * restaurada" en cada recarga de alguien que ya tenía sesión activa. Mismo
 * fondo verde bosque que el login: si no había sesión, la transición al
 * selector no produce un salto de color.
 */
export function BootstrappingScreen() {
  return (
    <main className="splash theme-inverse">
      <Brand as="h1" size="hero" />
      <LoadingState label="Restaurando tu sesión…" />
    </main>
  );
}
