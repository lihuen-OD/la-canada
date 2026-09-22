/**
 * Las 2 novedades reales de index.html (líneas 967-970). El texto es real;
 * la marca de tiempo original NO lo es — el prototipo la calculaba como
 * `Date.now() - N` (relativa al momento en que alguien abría la app, no una
 * fecha capturada), así que no hay una fecha histórica real que preservar.
 * El seed no fabrica una fecha falsa: `createdAt` queda en `now()` (el
 * default del modelo), documentado acá explícitamente — ver
 * docs/DATA_INVENTORY.md §6. Nunca las sembró `seedData()` en el
 * prototipo — diferencia documentada en docs/DATA_INVENTORY.md §15.
 */
export interface NewsReportSeed {
  employeeCode: string;
  text: string;
}

export const newsReportSeeds: readonly NewsReportSeed[] = [
  { employeeCode: 'pablo', text: 'La bomba de riego hace un ruido raro al arrancar.' },
  { employeeCode: 'coke', text: 'Falta jabón líquido en el baño de la planta baja.' },
];
