import { defineConfig } from 'vitest/config';

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
  },
});
