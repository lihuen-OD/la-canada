import { NavLink } from 'react-router-dom';

/**
 * Pestañas de 🥬 Huerta (mismo patrón `pill-nav` que Mascotas y Stock):
 * actividades, historial, Desempeño propio y participantes. `NavLink`:
 * navegación del router, nunca `<a href>`.
 */
export function KitchenGardenSubnav() {
  return (
    <nav className="garden-subnav pill-nav" aria-label="Secciones de la Huerta">
      <NavLink to="/kitchen-garden" end>
        <span aria-hidden="true">🌱 </span>Actividades
      </NavLink>
      <NavLink to="/kitchen-garden/history">
        <span aria-hidden="true">📅 </span>Historial
      </NavLink>
      <NavLink to="/kitchen-garden/performance">
        <span aria-hidden="true">🏆 </span>Desempeño
      </NavLink>
      <NavLink to="/kitchen-garden/participants">
        <span aria-hidden="true">👥 </span>Participantes
      </NavLink>
    </nav>
  );
}
