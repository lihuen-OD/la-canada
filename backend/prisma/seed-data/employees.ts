/**
 * Los 4 empleados reales declarados en index.html (líneas 928-933, idénticos
 * en `seedData()` líneas 1830-1835 salvo el mapeo de nombres de campo —
 * ver docs/DATA_INVENTORY.md §1). `code` es una clave natural estable
 * (slug interno) que no existe en el prototipo — se introduce acá para
 * poder sembrar de forma idempotente sin depender de IDs autoincrementales
 * heredados de Supabase (ver docs/MIGRATION_PLAN.md, "Identificadores
 * estables del seed").
 */
export interface EmployeeSeed {
  code: string;
  displayName: string;
  role: string;
  colorHex: string;
}

export const employeeSeeds: readonly EmployeeSeed[] = [
  { code: 'coke', displayName: 'Coke', role: 'Doméstica', colorHex: '#4a7c59' },
  { code: 'cami', displayName: 'Cami', role: 'Doméstica', colorHex: '#8b5e3c' },
  { code: 'ruth', displayName: 'Ruth', role: 'Doméstica', colorHex: '#6b7c8b' },
  { code: 'pablo', displayName: 'Pablo', role: 'Parque', colorHex: '#2c5364' },
];
