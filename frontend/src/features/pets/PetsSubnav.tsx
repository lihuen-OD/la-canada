import { NavLink } from 'react-router-dom';

/**
 * Pestañas de 🐾 Mascotas (mismo patrón que Stock): el listado y 📅
 * Vencimientos. `NavLink` marca la activa con `aria-current="page"`: navegación
 * del router, nunca `<a href>`.
 */
export function PetsSubnav() {
  return (
    <nav className="pets-subnav pill-nav" aria-label="Secciones de Mascotas">
      <NavLink to="/pets" end>
        <span aria-hidden="true">🐾 </span>Mascotas
      </NavLink>
      <NavLink to="/pets/due">
        <span aria-hidden="true">📅 </span>Vencimientos
      </NavLink>
    </nav>
  );
}
