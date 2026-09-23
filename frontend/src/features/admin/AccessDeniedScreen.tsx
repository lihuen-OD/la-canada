/**
 * Fallback de `RequireRole` para `/admin/users` — se muestra a cualquier
 * usuario autenticado que no sea `ADMIN` (hoy, `EMPLOYEE`). El backend
 * también rechaza estas rutas de forma independiente (`requireRole('ADMIN')`,
 * 403); esta pantalla solo evita mostrar contenido administrativo, nunca
 * reemplaza esa verificación real.
 */
export function AccessDeniedScreen() {
  return (
    <main className="full-screen-status">
      <p className="full-screen-status__text" role="alert">
        No tenés permisos para ver esta sección.
      </p>
    </main>
  );
}
