import { employeeSeeds } from './employees';
import { normalizeUsername } from './normalize';

/**
 * Una cuenta de usuario PENDING_ACTIVATION por cada empleado real, derivada
 * de `employeeSeeds` (garantiza 1:1 por construcción — nunca un username
 * sin empleado real detrás). Deliberadamente sin `pinHash` ni ningún
 * campo de credencial: no se inventa PIN ni hash — ver
 * "Usuarios reales" en las instrucciones de la Etapa 2 y
 * docs/ARCHITECTURE.md.
 *
 * No se crea ningún administrador acá — el admin inicial se crea después,
 * por un proceso separado basado en variables de entorno o un comando
 * administrativo (Etapa 3, autenticación), nunca con datos inventados en
 * el seed.
 */
export interface UserSeed {
  username: string;
  employeeCode: string;
}

export const userSeeds: readonly UserSeed[] = employeeSeeds.map((employee) => ({
  username: normalizeUsername(employee.displayName),
  employeeCode: employee.code,
}));
