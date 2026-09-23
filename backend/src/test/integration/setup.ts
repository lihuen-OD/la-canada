import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Solo para `vitest.integration.config.mts`: carga el `.env` de la raíz del
 * monorepo para que `process.env.DATABASE_URL` esté disponible — estos
 * tests corren aparte de la suite normal (ver `docs/ARCHITECTURE.md`,
 * "Neon — rama demo") precisamente porque necesitan una conexión real.
 */
config({ path: resolve(__dirname, '../../../../.env') });
