import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Variables mínimas para que la app arranque en los tests sin depender
    // de un .env real (que puede no existir, p. ej. en CI recién clonado).
    // DATABASE_URL ahora es obligatoria para el backend real (ver
    // config/env.ts) — acá es un valor sintético que nunca se usa para
    // conectar de verdad (nada en la suite normal ejecuta una query; los
    // tests que sí necesitan Neon real viven aparte, ver
    // vitest.integration.config.mts). Vitest inyecta esto en `process.env`
    // antes de que se cargue ningún módulo de test, así que sigue
    // funcionando exactamente igual con o sin un `.env` real presente.
    env: {
      NODE_ENV: 'test',
      FRONTEND_URL: 'http://localhost:5173',
      PORT: '4001',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      // Sintético, >=32 caracteres — nunca un secreto real. Igual patrón que
      // DATABASE_URL: garantiza que `npm test` nunca dependa de un `.env`
      // real para que la app (y las rutas de auth, montadas siempre) arranquen.
      JWT_ACCESS_SECRET: 'test-only-access-token-secret-do-not-use-in-prod',
    },
    // Los tests de integración (contra Neon real) quedan fuera de la suite
    // normal — requieren DATABASE_URL/DIRECT_URL y se corren explícitamente
    // con `npm run test:integration` (ver docs/ARCHITECTURE.md, "Neon — rama
    // demo"). `npm test` nunca debe depender de una conexión real.
    exclude: [...configDefaults.exclude, 'src/test/integration/**'],
  },
});
