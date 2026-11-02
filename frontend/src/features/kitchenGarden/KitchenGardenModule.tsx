import { Navigate, Route, Routes } from 'react-router-dom';
import { GardenHistoryScreen } from './GardenHistoryScreen';
import { GardenParticipantsScreen } from './GardenParticipantsScreen';
import { GardenPerformanceScreen } from './GardenPerformanceScreen';
import { GardenRecordsScreen } from './GardenRecordsScreen';

/**
 * 🥬 Huerta (`/kitchen-garden`): 📝 Registros (inicio del módulo), 📅
 * Historial, 🏆 Desempeño y 👥 Participantes como rutas descendientes SPA. Se
 * carga en diferido desde `AppRoutes`: ni el código ni los datos de la Huerta
 * se piden fuera del módulo. Las rutas de la propuesta anterior de cultivos
 * (`crops`, `crops/:id`, `records`) llevan a Registros: un enlace guardado
 * nunca termina en una pantalla rota.
 */
export default function KitchenGardenModule() {
  return (
    <Routes>
      <Route index element={<GardenRecordsScreen />} />
      <Route path="history" element={<GardenHistoryScreen />} />
      <Route path="performance" element={<GardenPerformanceScreen />} />
      <Route path="participants" element={<GardenParticipantsScreen />} />
      <Route path="*" element={<Navigate to="/kitchen-garden" replace />} />
    </Routes>
  );
}
