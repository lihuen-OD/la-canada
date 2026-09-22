import { Route, Routes } from 'react-router-dom';
import { StatusScreen } from '../components/StatusScreen';

/**
 * Único destino por ahora: la pantalla técnica temporal. Las rutas de los
 * módulos de negocio (Tareas, Stock, Gallinero, etc.) se agregan a partir
 * de la Etapa 6/7 del plan de migración.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<StatusScreen />} />
    </Routes>
  );
}
