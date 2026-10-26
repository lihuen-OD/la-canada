import {
  fetchGardenParticipantPerformance,
  fetchGardenPerformance,
} from '../../api/kitchenGardenApi';
import { queryKeys } from '../../api/queryKeys';
import { useAuth } from '../../auth/useAuth';
import { PerformanceScreen, type PerformanceSource } from '../tasks/PerformanceScreen';
import { GARDEN_NOUN, toPerformance } from './gardenAdapters';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';

/**
 * Desempeño PROPIO de la Huerta: sus endpoints y claves de caché, nunca los
 * de Tareas → Desempeño ni los de Inicio. Misma pantalla, mismos criterios
 * (el backend usa el mismo calculador) y solo presentación en el frontend.
 */
const GARDEN_PERFORMANCE: PerformanceSource = {
  summaryKey: queryKeys.kitchenGarden.performanceSummary,
  fetchSummary: async (from, to) => toPerformance(await fetchGardenPerformance(from, to)),
  detailKey: queryKeys.kitchenGarden.performanceParticipant,
  fetchDetail: async (participantId, from, to) =>
    toPerformance(await fetchGardenParticipantPerformance(participantId, from, to)),
};

export function GardenPerformanceScreen() {
  const { user } = useAuth();
  return (
    <PerformanceScreen
      source={GARDEN_PERFORMANCE}
      subnav={<KitchenGardenSubnav />}
      noun={GARDEN_NOUN}
      title={GARDEN_TITLE}
      emptyPeopleTitle={
        user?.role === 'ADMIN'
          ? 'Todavía no hay participantes en la Huerta.'
          : 'Tu desempeño aparece acá cuando participes de la Huerta.'
      }
    />
  );
}
