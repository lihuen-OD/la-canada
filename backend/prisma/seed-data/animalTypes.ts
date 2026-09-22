/**
 * Los 9 tipos de mascota reales declarados en index.html (línea 986,
 * `tiposMascota`, repetidos como `builtin` en línea 2638). Íconos tomados
 * de `TIPO_ICONS` (línea 2371-2377) — son datos reales declarados, no
 * inventados. Ninguno de los dos catálogos (el de `TIPO_ICONS` incluye más
 * tipos que no están en `tiposMascota`, ej. Ternero/Vaca/Toro) se siembra
 * más allá de estos 9: son los únicos que el prototipo trata como
 * precargados (ver docs/DATA_INVENTORY.md §9). No se siembra ningún
 * `Animal`: `mascotas = []` en el prototipo, sin animales reales
 * declarados.
 */
export interface AnimalTypeSeed {
  name: string;
  icon: string;
}

export const animalTypeSeeds: readonly AnimalTypeSeed[] = [
  { name: 'Perro', icon: '🐕' },
  { name: 'Gato', icon: '🐈' },
  { name: 'Caballo', icon: '🐴' },
  { name: 'Burro', icon: '🫏' },
  { name: 'Guinea', icon: '🐖' },
  { name: 'Pato', icon: '🦆' },
  { name: 'Pavo real', icon: '🦚' },
  { name: 'Gallina', icon: '🐔' },
  { name: 'Faisán', icon: '🦃' },
];
