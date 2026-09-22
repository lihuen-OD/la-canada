import { TaskFrequency } from '../../src/generated/prisma/enums';

/**
 * Las 10 tareas reales declaradas en index.html (líneas 934-945), idénticas
 * en contenido a `seedData()` (líneas 1839-1850) — comparadas explícitamente,
 * sin diferencias más allá del nombre de campo (`descripcion`→description,
 * `persona_id`→employeeCode, `frecuencia`→frequency). Ver
 * docs/DATA_INVENTORY.md §2.
 */
export interface TaskSeed {
  employeeCode: string;
  description: string;
  frequency: TaskFrequency;
}

export const taskSeeds: readonly TaskSeed[] = [
  { employeeCode: 'coke', description: 'Limpiar baños', frequency: TaskFrequency.DAILY },
  { employeeCode: 'coke', description: 'Aspirar planta baja', frequency: TaskFrequency.DAILY },
  { employeeCode: 'cami', description: 'Cambiar ropa de cama', frequency: TaskFrequency.WEEKLY },
  { employeeCode: 'cami', description: 'Limpiar cocina a fondo', frequency: TaskFrequency.WEEKLY },
  { employeeCode: 'ruth', description: 'Planchar ropa', frequency: TaskFrequency.DAILY },
  {
    employeeCode: 'ruth',
    description: 'Limpiar ventanas exteriores',
    frequency: TaskFrequency.MONTHLY,
  },
  {
    employeeCode: 'pablo',
    description: 'Cortar el pasto — zona principal',
    frequency: TaskFrequency.WEEKLY,
  },
  { employeeCode: 'pablo', description: 'Regar jardines', frequency: TaskFrequency.DAILY },
  {
    employeeCode: 'pablo',
    description: 'Revisar sistema de riego',
    frequency: TaskFrequency.MONTHLY,
  },
  { employeeCode: 'pablo', description: 'Fumigar perímetro', frequency: TaskFrequency.URGENT },
];
