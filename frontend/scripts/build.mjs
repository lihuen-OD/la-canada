// Build de producción del frontend (`npm run build`).
//
// Vite aplica un `NODE_ENV=development` definido en un archivo `.env`
// (el `.env` centralizado de la raíz lo define para el backend) SOLO si
// `process.env.NODE_ENV` no estaba definido al iniciar la resolución de la
// config — y esa comprobación ocurre antes de cargar `vite.config.ts`, así
// que no se puede corregir desde la config. Fijarlo acá, antes de importar
// Vite, garantiza siempre el build de producción de React sin tocar el
// `.env` ni depender de la terminal de cada desarrollador (funciona igual
// en macOS, Linux y Windows, sin `cross-env`). El backend corre en su propio
// proceso y no se ve afectado.
//
// Uso: node scripts/build.mjs [--outDir <ruta>]
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

process.env.NODE_ENV = 'production';

const { build } = await import('vite');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDirIndex = process.argv.indexOf('--outDir');
const outDir = outDirIndex === -1 ? undefined : process.argv[outDirIndex + 1];

await build({
  root,
  mode: 'production',
  build: outDir ? { outDir: path.resolve(outDir), emptyOutDir: true } : undefined,
});
