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
    // Todos estos archivos leen/escriben contra la MISMA base real (`demo`)
    // y varios miden conteos globales de `users`/`sessions`/`audit_logs`
    // como línea de base — correrlos en paralelo produce carreras falsas
    // entre archivos (uno crea una fila mientras otro está a mitad de su
    // verificación de conteo). Nunca afecta a `npm test` (suite normal,
    // config separada, sin este ajuste).
    fileParallelism: false,
    // Sintético — igual que en vitest.config.mts. Los tests de integración
    // necesitan Neon *real* (DATABASE_URL/DIRECT_URL, cargadas por
    // setup.ts desde el .env de la raíz), pero NO necesitan el
    // JWT_ACCESS_SECRET real: firmar/verificar tokens no depende de que el
    // secreto sea "el de verdad", solo de que sea consistente dentro de
    // esta corrida. Seteado ACÁ (antes de que setup.ts cargue el .env real)
    // para que, si el `.env` local todavía no tiene un valor propio
    // (dotenv nunca sobrescribe una variable ya presente), los tests
    // igual corran sin pedirle al usuario que genere uno solo para esto.
    env: {
      JWT_ACCESS_SECRET: 'test-only-integration-access-token-secret-32chars-min',
    },
  },
});
