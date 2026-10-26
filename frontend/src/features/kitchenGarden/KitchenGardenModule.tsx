import { Navigate, Route, Routes } from 'react-router-dom';
import { GardenActivitiesScreen } from './GardenActivitiesScreen';
import { GardenHistoryScreen } from './GardenHistoryScreen';
import { GardenParticipantsScreen } from './GardenParticipantsScreen';
import { GardenPerformanceScreen } from './GardenPerformanceScreen';

/**
 * 🥬 Huerta (`/kitchen-garden`): Actividades, 📅 Historial, 🏆 Desempeño y 👥
 * Participantes como rutas descendientes SPA. Se carga en diferido desde
 * `AppRoutes`: ni el código ni los datos de la Huerta se piden fuera del módulo.
 */
export default function KitchenGardenModule() {
  return (
    <Routes>
      <Route index element={<GardenActivitiesScreen />} />
      <Route path="history" element={<GardenHistoryScreen />} />
      <Route path="performance" element={<GardenPerformanceScreen />} />
      <Route path="participants" element={<GardenParticipantsScreen />} />
      <Route path="*" element={<Navigate to="/kitchen-garden" replace />} />
    </Routes>
  );
}
