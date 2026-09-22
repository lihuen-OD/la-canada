import { EventType } from '../../src/generated/prisma/enums';

/**
 * Los 2 eventos históricos reales confirmados de index.html (líneas
 * 995-999) — título, fecha, tipo y nota preservados exactamente. El tercer
 * evento del array original ("Cumpleaños de Benjamín", 2026-02-19) se
 * omite deliberadamente: contradice la fecha 16/09 usada en
 * `addFamilyBirthdays()` (línea 1761) y no hay forma de saber cuál es
 * correcta sin confirmación humana — ver "Decisiones sobre datos
 * pendientes → Benjamín" de la Etapa 2 y docs/BUSINESS_RULES.md §14. No se
 * genera ningún evento de cumpleaños acá bajo ningún nombre.
 *
 * Ninguno de los 3 eventos originales lo siembra `seedData()` en el
 * prototipo — el array `eventos` se sobreescribe con la respuesta de
 * Supabase antes de que la app renderice nada (ver docs/DATA_INVENTORY.md
 * §7 y §15).
 */
export interface EventSeed {
  title: string;
  date: string; // YYYY-MM-DD
  type: EventType;
  note: string | null;
}

export const eventSeeds: readonly EventSeed[] = [
  {
    title: 'Revisión bomba de agua',
    date: '2026-05-20',
    type: EventType.MAINTENANCE,
    note: 'Llamar al técnico antes',
  },
  {
    title: 'Visita familia O’Dwyer',
    date: '2026-06-15',
    type: EventType.VISIT,
    note: 'Preparar asado',
  },
];
