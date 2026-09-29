import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { clearRefreshAttempt } from '../auth/refreshAttempt';
import { resetRefreshRecovery } from '../auth/refreshRecovery';
import {
  markBackendReachable,
  resetBackendAvailability,
} from '../connectivity/backendAvailability';

/**
 * Etapa 5R — el coordinador de disponibilidad y el estado del refresh viven a
 * nivel de módulo. Cada test arranca con el backend ya comprobado (`online`):
 * así los tests que no tratan de conectividad no ven el `GET /health` inicial
 * ni sus requests cambian. Los tests de arranque en frío llaman a
 * `resetBackendAvailability()` para empezar desde `idle`.
 */
beforeEach(() => {
  resetBackendAvailability();
  resetRefreshRecovery();
  clearRefreshAttempt();
  markBackendReachable();
});

afterEach(() => {
  resetBackendAvailability();
  resetRefreshRecovery();
  clearRefreshAttempt();
});
