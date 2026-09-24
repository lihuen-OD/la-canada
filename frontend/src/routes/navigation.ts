import type { SystemRole } from '../api/types';

export type NavIconName = 'home' | 'users';

export interface AppRouteDefinition {
  path: string;
  label: string;
  icon: NavIconName;
  /** Rol exigido para la ruta. El mismo valor protege la ruta (`RequireRole`) y filtra el menú. */
  requiredRole?: SystemRole;
}

/**
 * Única fuente de verdad de las rutas autenticadas que existen HOY. `AppRoutes`
 * usa estas definiciones para declarar las rutas y su rol requerido, y
 * `AppShell` para armar la navegación — así nunca pueden divergir (un
 * destino del menú sin ruta, o una ruta admin-only visible para
 * cualquiera). Nunca se agregan acá destinos de módulos que todavía no
 * existen (Tareas, Stock, etc.), ni siquiera deshabilitados: cada módulo
 * suma su entrada en la etapa en que se construye.
 *
 * El backend sigue siendo la autoridad final: filtrar el menú solo evita
 * ofrecer un destino que igual se rechazaría.
 */
export const APP_ROUTES = {
  home: { path: '/', label: 'Inicio', icon: 'home' },
  adminUsers: { path: '/admin/users', label: 'Usuarios', icon: 'users', requiredRole: 'ADMIN' },
} as const satisfies Record<string, AppRouteDefinition>;

const NAVIGATION_ORDER: readonly AppRouteDefinition[] = [APP_ROUTES.home, APP_ROUTES.adminUsers];

export function getVisibleNavigation(
  hasRole: (role: SystemRole) => boolean,
): readonly AppRouteDefinition[] {
  return NAVIGATION_ORDER.filter((route) => !route.requiredRole || hasRole(route.requiredRole));
}
