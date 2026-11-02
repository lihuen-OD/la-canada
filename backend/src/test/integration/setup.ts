import { resolve } from 'node:path';
import { loadLocalEnvFiles } from '../../config/localEnvFiles';

/**
 * Solo para `vitest.integration.config.mts`: carga el `.env` de la raíz del
 * monorepo para que `process.env.DATABASE_URL` esté disponible — estos
 * tests corren aparte de la suite normal (ver `docs/ARCHITECTURE.md`,
 * "Neon — rama demo") precisamente porque necesitan una conexión real.
 * Con `LA_CANADA_ENV_FILE`, primero ese archivo (rama de base aislada).
 */
loadLocalEnvFiles(resolve(__dirname, '../../../..'));
