import { defineConfig } from 'vitest/config';

/**
 * Config separada, exclusiva de los tests de integración contra Neon real
 * (rama `demo`). Nunca se usa en `npm test` (ver `vitest.config.mts`, que
 * excluye `src/test/integration/**`) — se invoca explícitamente con
 * `npm run test:integration`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/test/integration/**/*.test.ts'],
    setupFiles: ['./src/test/integration/setup.ts'],
    testTimeout: 20_000,
  },
});
