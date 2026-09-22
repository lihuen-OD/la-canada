/**
 * Ubicación real de la propiedad, usada por el módulo de Clima del
 * prototipo (coordenadas hardcodeadas en `fetchClima()`, index.html línea
 * 1647: lat -32.15, lon -58.40; etiqueta "Villa Elisa, Entre Ríos" en
 * varios lugares de la UI). Dato real, no inventado — ver
 * docs/DATA_INVENTORY.md §14.
 *
 * `code: 'main'` es la clave natural estable del singleton (ver
 * `PropertyLocation.code` en el schema) — el negocio actual tiene una única
 * propiedad. `label` es solo el nombre legible.
 */
export interface PropertyLocationSeed {
  code: string;
  label: string;
  latitude: string;
  longitude: string;
}

export const propertyLocationSeed: PropertyLocationSeed = {
  code: 'main',
  label: 'Villa Elisa, Entre Ríos',
  latitude: '-32.15',
  longitude: '-58.40',
};
