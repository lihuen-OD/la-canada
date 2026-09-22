import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Variables mínimas para que la app arranque en los tests sin depender
    // de un .env real (que puede no existir, p. ej. en CI recién clonado).
    env: {
      NODE_ENV: 'test',
      FRONTEND_URL: 'http://localhost:5173',
      PORT: '4001',
    },
    // Los tests de integración (contra Neon real) quedan fuera de la suite
    // normal — requieren DATABASE_URL/DIRECT_URL y se corren explícitamente
    // con `npm run test:integration` (ver docs/ARCHITECTURE.md, "Neon — rama
    // demo"). `npm test` nunca debe depender de una conexión real.
    exclude: [...configDefaults.exclude, 'src/test/integration/**'],
  },
});
