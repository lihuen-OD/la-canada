import { NavLink } from 'react-router-dom';

/**
 * Pestañas internas de Tareas. `NavLink` (nunca `<a href>`): navegar entre
 * Tareas y Desempeño es una transición SPA — no recarga el documento, no
 * reinicia React ni vuelve a restaurar la sesión (Etapa 5P). `NavLink` marca
 * la pestaña activa con la clase `active` y `aria-current="page"`.
 */
export function TasksSubnav() {
  return (
    <nav className="tasks-subnav" aria-label="Secciones de Tareas">
      <NavLink to="/tasks" end>
        ✅ Tareas
      </NavLink>
      <NavLink to="/tasks/performance">📊 Desempeño</NavLink>
    </nav>
  );
}
