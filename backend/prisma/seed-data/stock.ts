import { StockArea, StockMovementType } from '../../src/generated/prisma/enums';

/**
 * Las 13 categorías de stock declaradas en index.html (línea 913-914,
 * `CATS_CASA` + `CATS_JARDIN`). "Alimentos" y "Varios" existen dos veces
 * (una por área) porque el prototipo las declara como dos arrays de texto
 * planos, sin deduplicar entre áreas — ver docs/DATA_INVENTORY.md §5.
 * Estas 13 filas nunca las siembra `seedData()` en el prototipo (solo
 * viven como fallback en el JS del cliente) — diferencia documentada
 * explícitamente en docs/DATA_INVENTORY.md §15.
 */
export interface StockCategorySeed {
  name: string;
  area: StockArea;
}

export const stockCategorySeeds: readonly StockCategorySeed[] = [
  { name: 'Limpieza', area: StockArea.HOUSE },
  { name: 'Alimentos', area: StockArea.HOUSE },
  { name: 'Baño', area: StockArea.HOUSE },
  { name: 'Ropa/Textil', area: StockArea.HOUSE },
  { name: 'Medicamentos', area: StockArea.HOUSE },
  { name: 'Varios', area: StockArea.HOUSE },
  { name: 'Fertilizantes', area: StockArea.GARDEN },
  { name: 'Combustibles', area: StockArea.GARDEN },
  { name: 'Herramientas', area: StockArea.GARDEN },
  { name: 'Fitosanitarios', area: StockArea.GARDEN },
  { name: 'Alimentos', area: StockArea.GARDEN },
  { name: 'Pileta', area: StockArea.GARDEN },
  { name: 'Varios', area: StockArea.GARDEN },
];

/**
 * Los 14 productos reales (7 Casa + 7 Jardín) de index.html líneas 949-966,
 * idénticos en contenido a `seedData()` líneas 1852-1866 (comparados
 * explícitamente, sin diferencias más allá del nombre de campo). La
 * cantidad inicial (`openingQuantity`) se carga como un StockMovement
 * `OPENING_BALANCE`, no como un valor "de la nada" en `StockItem` — ver
 * "Estrategia de inventario" en docs/DATABASE.md. Ver docs/DATA_INVENTORY.md
 * §3-4.
 */
export interface StockItemSeed {
  name: string;
  area: StockArea;
  categoryName: string;
  unit: string;
  minimumQuantity: string;
  openingQuantity: string;
  movementType: typeof StockMovementType.OPENING_BALANCE;
}

export const stockItemSeeds: readonly StockItemSeed[] = [
  // Casa
  {
    name: 'Detergente',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'litros',
    minimumQuantity: '3',
    openingQuantity: '2',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Lavandina',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'litros',
    minimumQuantity: '3',
    openingQuantity: '5',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Desinfectante pisos',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'litros',
    minimumQuantity: '2',
    openingQuantity: '1',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Papel higiénico',
    area: StockArea.HOUSE,
    categoryName: 'Baño',
    unit: 'rollos',
    minimumQuantity: '12',
    openingQuantity: '24',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Bolsas de basura',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'unidades',
    minimumQuantity: '20',
    openingQuantity: '30',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Trapos de piso',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'unidades',
    minimumQuantity: '4',
    openingQuantity: '3',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Esponjas',
    area: StockArea.HOUSE,
    categoryName: 'Limpieza',
    unit: 'unidades',
    minimumQuantity: '5',
    openingQuantity: '6',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  // Jardín
  {
    name: 'Fertilizante NPK',
    area: StockArea.GARDEN,
    categoryName: 'Fertilizantes',
    unit: 'kg',
    minimumQuantity: '10',
    openingQuantity: '5',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Herbicida glifosato',
    area: StockArea.GARDEN,
    categoryName: 'Fitosanitarios',
    unit: 'litros',
    minimumQuantity: '2',
    openingQuantity: '3',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Insecticida',
    area: StockArea.GARDEN,
    categoryName: 'Fitosanitarios',
    unit: 'litros',
    minimumQuantity: '2',
    openingQuantity: '1',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Combustible motosierra',
    area: StockArea.GARDEN,
    categoryName: 'Combustibles',
    unit: 'litros',
    minimumQuantity: '5',
    openingQuantity: '8',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Combustible cortadora',
    area: StockArea.GARDEN,
    categoryName: 'Combustibles',
    unit: 'litros',
    minimumQuantity: '5',
    openingQuantity: '4',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Mangueras de repuesto',
    area: StockArea.GARDEN,
    categoryName: 'Herramientas',
    unit: 'metros',
    minimumQuantity: '1',
    openingQuantity: '2',
    movementType: StockMovementType.OPENING_BALANCE,
  },
  {
    name: 'Guantes de trabajo',
    area: StockArea.GARDEN,
    categoryName: 'Herramientas',
    unit: 'pares',
    minimumQuantity: '2',
    openingQuantity: '1',
    movementType: StockMovementType.OPENING_BALANCE,
  },
];
