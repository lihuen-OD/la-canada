/**
 * Pantalla de carga estable mientras se intenta restaurar la sesión al
 * iniciar la app (`AuthProvider`, un único `POST /auth/refresh`). Se
 * muestra en vez del selector de login para no parpadear "login → sesión
 * restaurada" en cada recarga de alguien que ya tenía sesión activa.
 */
export function BootstrappingScreen() {
  return (
    <main className="full-screen-status">
      <p className="full-screen-status__text" role="status" aria-live="polite">
        Restaurando tu sesión…
      </p>
    </main>
  );
}
